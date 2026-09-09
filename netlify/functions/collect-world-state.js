// Context Collector v2 — Netlify Function
// Triggered by: app open, manual refresh.
//
// What it does:
//   1. Fetch ALL non-closed Beads issues directly from DoltHub SQL API
//   2. Replace beads_ready rows in Supabase with the fresh snapshot
//   3. Read open_tasks from Supabase
//   4. Compute derived fields (overdue, due today, due this week)
//   5. Return assembled world state to the caller
//
// Note: fetches ALL non-closed issues (open, in_progress, blocked, deferred) —
// not just unblocked "ready" ones. The UI is a status board, not a claim queue.
//
// Env vars required:
//   SUPABASE_URL              Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY Service role key (server-side only)

import { createClient } from '@supabase/supabase-js';
import { extractUserId } from '../lib/auth.js';

const DOLTHUB_API = 'https://www.dolthub.com/api/v1alpha1/mofro/beads-global/main';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function doltQuery(sql) {
  const url = `${DOLTHUB_API}?q=${encodeURIComponent(sql)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`DoltHub error: ${res.status}`);
  const body = await res.json();
  if (body.query_execution_status !== 'Success') {
    throw new Error(`DoltHub query failed: ${body.query_execution_message}`);
  }
  return body.rows;
}

export default async (req) => {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
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

  // ── Step 1: Fetch all non-closed issues from DoltHub ──────────────────────
  // Reads directly from DoltHub SQL API — no Railway sync step needed because
  // DoltHub is the remote source of truth (not a local copy that can be stale).
  // Builds two derived maps in one pass:
  //   taskToFeature: taskId → parent feature metadata (for hierarchy grouping)
  //   blockedByMap:  issueId → [dep ids that are still open] (for status display)
  let freshIssues = [];
  let beadsError = null;
  let taskToFeature = {};
  let blockedByMap  = {};

  try {
    const [issueRows, depRows] = await Promise.all([
      doltQuery(`
        SELECT id, title, status, priority, issue_type, updated_at, created_at, source_repo
        FROM issues
        WHERE status != 'closed'
        ORDER BY priority ASC, updated_at DESC
        LIMIT 2000
      `),
      doltQuery(`
        SELECT issue_id, depends_on_id
        FROM dependencies
        LIMIT 5000
      `),
    ]);

    // Normalise priority to number once
    const allOpen = issueRows.map(i => ({
      ...i,
      priority: i.priority != null ? Number(i.priority) : null,
      dependencies: [],
    }));

    const openIds = new Set(allOpen.map(i => i.id));

    // Attach deps to each issue and build the two derived maps
    const depsByIssue = {};
    for (const d of depRows) {
      if (!depsByIssue[d.issue_id]) depsByIssue[d.issue_id] = [];
      depsByIssue[d.issue_id].push(d.depends_on_id);
    }

    for (const issue of allOpen) {
      const deps = depsByIssue[issue.id] || [];
      issue.dependencies = deps.map(id => ({ depends_on_id: id }));

      // blocked_by: deps whose own issue is still open
      const openDeps = deps.filter(id => openIds.has(id));
      if (openDeps.length) blockedByMap[issue.id] = openDeps;

      // feature → task reverse map (for parent feature context on tasks)
      if (issue.issue_type !== 'feature') continue;
      for (const depId of deps) {
        const existing = taskToFeature[depId];
        if (!existing || issue.priority < existing.parent_priority) {
          taskToFeature[depId] = {
            parent_feature_id:    issue.id,
            parent_feature_title: issue.title,
            parent_priority:      issue.priority,
          };
        }
      }
    }

    freshIssues = allOpen;
    console.log(`[collect-world-state] Fetched ${freshIssues.length} open issues from DoltHub`);
  } catch (e) {
    beadsError = e.message;
    console.error('[collect-world-state] DoltHub fetch failed:', e.message);
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
