// Context Collector v1 — Netlify Function
// Triggered by: app open, manual refresh (Dolt hook trigger: life-43k, deferred).
//
// What it does:
//   1. Fetch ALL open (non-closed) Beads issues from the Railway Beads Service
//   2. Replace beads_ready rows in Supabase with the fresh snapshot
//   3. Read open_tasks from Supabase
//   4. Compute derived fields (overdue, due today, due this week)
//   5. Return assembled world state to the caller
//
// Note: fetches ALL non-closed issues (open, in_progress, blocked) — not just
// unblocked "ready" ones. The UI is a status board, not a claim queue.
//
// Env vars required (set in Netlify dashboard → Environment variables):
//   BEADS_SERVICE_URL       Railway Beads Service base URL
//   BEADS_API_KEY           Shared secret for Railway auth
//   SUPABASE_URL            Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY  Service role key (server-side only — never expose to client)
//   userId        UUID of the single user (single-user system, v1)

import { createClient } from '@supabase/supabase-js';
import { extractUserId } from '../lib/auth.js';

const {
  BEADS_SERVICE_URL,
  BEADS_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (req) => {
  // Validate environment
  const missing = ['BEADS_SERVICE_URL', 'BEADS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
    .filter(k => !process.env[k]);
  if (missing.length) {
    console.error('[collect-world-state] Missing env vars:', missing.join(', '));
    return json({ error: `Missing configuration: ${missing.join(', ')}` }, 500);
  }

  let userId;
  try { userId = await extractUserId(req); }
  catch { return json({ error: 'Unauthorized' }, 401); }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();

  // ── Step 1: Sync Railway from DoltHub, then fetch ready issues ───────────────
  // POST /api/beads/sync triggers bd dolt pull on Railway so it has the latest
  // data from DoltHub before we ask for the ready list.
  // Failure is non-fatal: we proceed with whatever data Railway currently has.
  let freshIssues = [];
  let beadsError = null;
  const beadsHeaders = { Authorization: `Bearer ${BEADS_API_KEY}` };

  try {
    const syncRes = await fetch(`${BEADS_SERVICE_URL}/api/beads/sync`, {
      method: 'POST',
      headers: beadsHeaders,
      signal: AbortSignal.timeout(15_000),  // pull can take a few seconds
    });
    const syncBody = await syncRes.json().catch(() => ({}));
    if (syncBody.ok) {
      console.log(`[collect-world-state] Railway synced from DoltHub at ${syncBody.syncedAt}`);
    } else {
      console.warn('[collect-world-state] Railway sync failed (proceeding with stale data):', syncBody.error);
    }
  } catch (e) {
    console.warn('[collect-world-state] Railway sync unreachable (proceeding with stale data):', e.message);
  }

  // ── Step 1b: Fetch all open issues ──────────────────────────────────────────
  // Returns open + in_progress + blocked — everything non-closed.
  // Also builds two derived maps in one pass:
  //   taskToFeature: taskId → parent feature metadata (for hierarchy grouping)
  //   blockedByMap:  issueId → [dep ids that are still open] (for status display)
  let taskToFeature = {};
  let blockedByMap  = {};
  try {
    const listRes = await fetch(`${BEADS_SERVICE_URL}/api/beads/list?status=open`, {
      headers: beadsHeaders,
      signal: AbortSignal.timeout(10_000),
    });
    if (!listRes.ok) throw new Error(`Beads list returned HTTP ${listRes.status}`);

    const allOpen = await listRes.json();
    const openIds = new Set(allOpen.map(i => i.id));

    for (const issue of allOpen) {
      // Build blocked_by: deps whose own issue is still open
      const openDeps = (issue.dependencies || [])
        .map(d => d.depends_on_id)
        .filter(id => openIds.has(id));
      if (openDeps.length) blockedByMap[issue.id] = openDeps;

      // Build feature→task reverse map
      if (issue.issue_type !== 'feature') continue;
      for (const dep of (issue.dependencies || [])) {
        const tid = dep.depends_on_id;
        const existing = taskToFeature[tid];
        if (!existing || issue.priority < existing.parent_priority) {
          taskToFeature[tid] = {
            parent_feature_id:    issue.id,
            parent_feature_title: issue.title,
            parent_priority:      typeof issue.priority === 'number' ? issue.priority : null,
          };
        }
      }
    }

    freshIssues = allOpen;
    console.log(`[collect-world-state] Fetched ${freshIssues.length} open issues from Beads Service`);
  } catch (e) {
    beadsError = e.message;
    console.error('[collect-world-state] Beads fetch failed:', e.message);
    // Fall through — return stale beads_ready rows from Supabase
  }

  // ── Step 2: Replace beads_ready snapshot ──────────────────────────────────
  // Only write if we got a fresh response (don't clobber stale data on error).
  if (!beadsError) {
    // Delete all existing rows for this user, then insert the fresh set.
    // Simple replace strategy is safe for a single-user personal tool.
    const { error: delErr } = await supabase
      .from('beads_ready')
      .delete()
      .eq('user_id', userId);

    if (delErr) {
      console.error('[collect-world-state] beads_ready delete failed:', delErr.message);
    } else if (freshIssues.length > 0) {
      const rows = freshIssues.map(issue => ({
        user_id:    userId,
        issue_id:   issue.id,
        title:      issue.title,
        priority:   typeof issue.priority === 'number' ? issue.priority : null,
        blocked_by: blockedByMap[issue.id] || [],
        status:     issue.status     || null,
        issue_type: issue.issue_type || null,
        synced_at:  now.toISOString(),
        ...(taskToFeature[issue.id] || { parent_feature_id: null, parent_feature_title: null, parent_priority: null }),
      }));

      const { error: insErr } = await supabase.from('beads_ready').insert(rows);
      if (insErr) console.error('[collect-world-state] beads_ready insert failed:', insErr.message);
    }
  }

  // ── Step 3: Read beads_ready (fresh or stale) ─────────────────────────────
  const { data: beadsRows, error: beadsReadErr } = await supabase
    .from('beads_ready')
    .select('*')
    .eq('user_id', userId)
    .order('priority', { ascending: true });

  if (beadsReadErr) console.error('[collect-world-state] beads_ready read failed:', beadsReadErr.message);

  // ── Step 4: Read open tasks ───────────────────────────────────────────────
  const { data: taskRows, error: taskErr } = await supabase
    .from('open_tasks')
    .select('*')
    .eq('user_id', userId)
    .not('status', 'in', '(completed,cancelled)')
    .order('deadline', { ascending: true, nullsFirst: false });

  if (taskErr) console.error('[collect-world-state] open_tasks read failed:', taskErr.message);

  // ── Step 5: Derived fields ────────────────────────────────────────────────
  const tasks = taskRows || [];
  const todayEnd  = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const weekEnd   = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);

  const derived = {
    tasks_overdue:       tasks.filter(t => t.deadline && new Date(t.deadline) < now).length,
    tasks_due_today:     tasks.filter(t => t.deadline && new Date(t.deadline) <= todayEnd).length,
    tasks_due_this_week: tasks.filter(t => t.deadline && new Date(t.deadline) <= weekEnd).length,
  };

  return json({
    beadsReady:  beadsRows || [],
    openTasks:   tasks,
    derived,
    syncedAt:    now.toISOString(),
    beadsError,  // null = fresh; string = stale data with reason
  });
};
