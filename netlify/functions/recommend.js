// Context Reasoner — on-demand Claude recommendations (life-tm6, life-jeh, life-b7v)
//
// GET  /.netlify/functions/recommend  → restore last saved recommendation (no Claude call)
// POST /.netlify/functions/recommend  → generate fresh recommendation (Claude, 30-min cache)
//
// GET response shape:
//   { focus, queue, overdue, summary, historyId, item_feedback, stale: bool, restored: true }
//   { emptyState: true }  when no history exists
//
// POST response shape:
//   {
//     focus:   {id, title, source, ..., reason, window?} | null,
//     queue:   [{id, title, source, ..., reason, window?}],
//     overdue: [{id, title, source, ..., reason}],
//     summary: string,
//     cached:  bool,
//     cachedAt: ISO string | null,
//     model:   string,
//   }
//
// Error shape:
//   { error: string }  with appropriate HTTP status
//
// Env vars required:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_USER_ID

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { computeFreeBlocks } from '../lib/freeBlocks.js';
import { extractUserId } from '../lib/auth.js';

const CACHE_TTL_MS = 30 * 60 * 1000;
const MODEL        = 'claude-haiku-4-5-20251001';
const MAX_TOKENS   = 1500;

const BEADS_PRIORITY = { 0: 'high', 1: 'high', 2: 'medium', 3: 'low', 4: 'low' };
const TASK_PRIORITY  = { 0: 'high', 1: 'high', 2: 'medium', 3: 'low', 4: 'low' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Stable hash of the world state — set of IDs, sorted. */
function worldStateHash(beadsReady, openTasks) {
  const beadsIds = beadsReady.map(b => b.issue_id).sort().join(',');
  const taskIds  = openTasks.map(t => String(t.id)).sort().join(',');
  return `b:${beadsIds}|t:${taskIds}`;
}

/** Latest weight per category (weights are pre-sorted by effective_from DESC). */
function dedupWeights(allWeights) {
  const seen = new Set();
  return allWeights.filter(w => {
    if (seen.has(w.category)) return false;
    seen.add(w.category);
    return true;
  });
}

/** Build the AVAILABLE TIME prompt section using computeFreeBlocks for 7 days. */
function buildAvailabilityText(calendarRows, prefs, activeRejections, now, userTz) {
  const lines = [];
  for (let i = 0; i < 7; i++) {
    const d       = new Date(now.getTime() + i * 86_400_000);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: userTz });
    const dayFmt  = new Intl.DateTimeFormat('en-US', { timeZone: userTz, weekday: 'short', month: 'short', day: 'numeric' });
    const label   = i === 0 ? `Today ${dayFmt.format(d)}` : dayFmt.format(d);

    const row    = calendarRows.find(r => r.event_date === dateStr);
    const raw    = Array.isArray(row?.events) ? row.events : [];
    const events = raw
      .map(e => ({ start: e.startISO ?? e.start, end: e.endISO ?? e.end }))
      .filter(e => e.start && e.end);

    const blocks = computeFreeBlocks(
      events,
      prefs.weekly_schedule    ?? [],
      prefs.schedule_exceptions ?? [],
      prefs.planning_window    ?? null,
      activeRejections,
      dateStr,
      userTz,
    );

    if (blocks.length === 0) {
      const exception = (prefs.schedule_exceptions ?? []).find(e => e.date === dateStr);
      lines.push(`  ${label}: ${exception?.type === 'off' ? 'free day (schedule exception)' : 'no free blocks'}`);
    } else {
      const blockStrs = blocks.map(b => {
        const s   = new Date(b.startISO).toLocaleTimeString('en-US', { timeZone: userTz, hour: '2-digit', minute: '2-digit', hour12: false });
        const e   = new Date(b.endISO).toLocaleTimeString('en-US', { timeZone: userTz, hour: '2-digit', minute: '2-digit', hour12: false });
        const tag = b.preferred ? '' : ' ← evening';
        return `${s}-${e} (${b.durationMinutes} min)${tag}`;
      });
      lines.push(`  ${label}: ${blockStrs.join(', ')}`);
    }
  }
  return lines.join('\n');
}

/** Resolve a Claude ref string to a full task object. Returns null on miss (logs warn). */
function resolveRef(ref, reason, window, openTasks, beadsReady) {
  if (!ref) return null;

  if (ref.startsWith('task:')) {
    const id   = parseInt(ref.replace('task:', ''), 10);
    const task = openTasks.find(t => t.id === id);
    if (!task) { console.warn(`[recommend] ref ${ref} not found in openTasks`); return null; }
    return {
      id:           task.id,
      title:        task.title,
      source:       task.source         || 'manual',
      sourceUrl:    task.source_url      || null,
      priority:     TASK_PRIORITY[task.priority] ?? 'medium',
      deadline:     task.deadline        || null,
      timeRequired: task.time_required_minutes || null,
      category:     task.category        || 'adhoc',
      reason,
      ...(window ? { window } : {}),
    };
  }

  if (ref.startsWith('beads:')) {
    const issueId = ref.replace('beads:', '');
    const bead    = beadsReady.find(b => b.issue_id === issueId);
    if (!bead) { console.warn(`[recommend] ref ${ref} not found in beadsReady`); return null; }
    return {
      id:           bead.id,
      beadsId:      bead.issue_id,
      title:        bead.title,
      source:       'beads',
      sourceUrl:    null,
      priority:     BEADS_PRIORITY[bead.priority] ?? 'medium',
      deadline:     null,
      timeRequired: null,
      reason,
      ...(window ? { window } : {}),
    };
  }

  console.warn(`[recommend] Unknown ref format: ${ref}`);
  return null;
}

/**
 * Aggregate item_feedback from recent history rows and build a prompt section.
 * Only called on POST path.
 */
function buildFeedbackText(feedbackRows, openTasks, beadsReady) {
  const counts = {};
  for (const row of feedbackRows ?? []) {
    for (const fb of (row.item_feedback ?? [])) {
      if (!fb.ref || !fb.action) continue;
      if (!counts[fb.ref]) counts[fb.ref] = { dismissed: 0, accepted: 0 };
      if (fb.action === 'dismissed') counts[fb.ref].dismissed++;
      if (fb.action === 'accepted')  counts[fb.ref].accepted++;
    }
  }

  const titleOf = (ref) => {
    if (ref.startsWith('task:')) {
      const id = parseInt(ref.replace('task:', ''), 10);
      return openTasks.find(t => t.id === id)?.title ?? ref;
    }
    if (ref.startsWith('beads:')) {
      const issueId = ref.replace('beads:', '');
      return beadsReady.find(b => b.issue_id === issueId)?.title ?? ref;
    }
    return ref;
  };

  const dismissed = Object.entries(counts)
    .filter(([, c]) => c.dismissed >= 1)
    .sort(([, a], [, b]) => b.dismissed - a.dismissed);
  const accepted = Object.entries(counts)
    .filter(([, c]) => c.accepted >= 2)
    .sort(([, a], [, b]) => b.accepted - a.accepted);

  if (dismissed.length === 0 && accepted.length === 0) return '';

  const lines = ['PAST FEEDBACK (last 10 sessions):'];
  if (dismissed.length > 0) {
    lines.push('  Frequently dismissed — only recommend if deadline is imminent or conditions changed:');
    for (const [ref, c] of dismissed) {
      lines.push(`    - ${ref} "${titleOf(ref)}" dismissed:${c.dismissed}x`);
    }
  }
  if (accepted.length > 0) {
    lines.push('  Accepted — user engaged with these:');
    for (const [ref, c] of accepted) {
      lines.push(`    - ${ref} "${titleOf(ref)}" accepted:${c.accepted}x`);
    }
  }
  return lines.join('\n');
}

export default async (req) => {
  // ── Validate env ────────────────────────────────────────────────────────────
  const missing = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
    .filter(k => !process.env[k]);
  if (missing.length) {
    console.error('[recommend] Missing env vars:', missing.join(', '));
    return json({ error: `Missing configuration: ${missing.join(', ')}` }, 500);
  }

  let userId;
  try { userId = await extractUserId(req); }
  catch { return json({ error: 'Unauthorized' }, 401); }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const now      = new Date();

  // ── GET: restore last saved recommendation (no Claude call) ────────────────
  const method = req?.method?.toUpperCase() ?? 'POST';
  if (method === 'GET') {
    const { data: rows } = await supabase
      .from('recommendation_history')
      .select('id,content,item_feedback,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    const row = rows?.[0];
    if (!row) return json({ emptyState: true });

    const age = Date.now() - new Date(row.created_at).getTime();
    return json({
      focus:         row.content?.focus   ?? null,
      queue:         row.content?.queue   ?? [],
      overdue:       row.content?.overdue ?? [],
      summary:       row.content?.summary ?? null,
      historyId:     row.id,
      item_feedback: row.item_feedback    ?? [],
      stale:         age > CACHE_TTL_MS,
      restored:      true,
      cachedAt:      row.created_at,
    });
  }

  // ── Read world state (all parallel) ────────────────────────────────────────
  const [beadsResult, tasksResult, prefsResult, weightsResult, rejectionsResult] = await Promise.all([
    supabase
      .from('beads_ready')
      .select('*')
      .eq('user_id', userId)
      .order('priority', { ascending: true }),
    supabase
      .from('open_tasks')
      .select('id,title,priority,deadline,status,source,source_url,time_required_minutes,category')
      .eq('user_id', userId)
      .not('status', 'in', '(completed,cancelled)')
      .order('deadline', { ascending: true, nullsFirst: false }),
    supabase
      .from('user_preferences')
      .select('timezone,weekly_schedule,schedule_exceptions,planning_window,categories')
      .eq('user_id', userId)
      .single(),
    supabase
      .from('category_weights')
      .select('category,weight,effective_from')
      .eq('user_id', userId)
      .order('effective_from', { ascending: false }),
    supabase
      .from('block_rejections')
      .select('day_of_week,start_time,end_time,released_at')
      .eq('user_id', userId)
      .is('released_at', null),
  ]);

  const prefs            = prefsResult.data    || {};
  const userTz           = prefs.timezone      || 'UTC';
  const beadsReady       = beadsResult.data    || [];
  const openTasks        = tasksResult.data    || [];
  const allWeights       = weightsResult.data  || [];
  const activeRejections = rejectionsResult.data || [];

  // Calendar rows + recent feedback — both parallel.
  const localDateStr = now.toLocaleDateString('en-CA', { timeZone: userTz });
  const [calendarResult, feedbackResult] = await Promise.all([
    supabase
      .from('calendar_snapshot')
      .select('event_date,events')
      .eq('user_id', userId)
      .gte('event_date', localDateStr)
      .order('event_date', { ascending: true })
      .limit(7),
    supabase
      .from('recommendation_history')
      .select('item_feedback')
      .eq('user_id', userId)
      .not('item_feedback', 'eq', '[]')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);
  const calendarRows  = calendarResult.data  || [];
  const feedbackRows  = feedbackResult.data  || [];

  // ── Seed category_weights on first run ─────────────────────────────────────
  let categoryWeights = dedupWeights(allWeights);
  if (categoryWeights.length === 0) {
    const categories = prefs.categories ?? ['professional', 'home', 'hobby', 'social', 'adhoc'];
    await supabase.from('category_weights').insert(
      categories.map(cat => ({ user_id: userId, category: cat, weight: 0.5, set_by: 'system' })),
    );
    categoryWeights = categories.map(cat => ({ category: cat, weight: 0.5 }));
    console.log('[recommend] Seeded category_weights with defaults');
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (beadsReady.length === 0 && openTasks.length === 0) {
    return json({
      focus: null, queue: [], overdue: [],
      summary: null,
      emptyState: true,
      message: 'No open tasks or unblocked Beads issues. Add a task or run `bd ready` to surface work.',
      cached: false,
    });
  }

  // ── Cache check ─────────────────────────────────────────────────────────────
  const currentHash = worldStateHash(beadsReady, openTasks);

  const { data: cacheRows } = await supabase
    .from('recommendation_history')
    .select('id,content,world_state_snapshot,model,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  const cached = cacheRows?.[0];
  if (cached) {
    const age        = Date.now() - new Date(cached.created_at).getTime();
    const cachedHash = cached.world_state_snapshot?.hash;
    if (age < CACHE_TTL_MS && cachedHash === currentHash) {
      console.log('[recommend] Cache hit — returning cached portfolio');
      return json({
        focus:     cached.content?.focus   ?? null,
        queue:     cached.content?.queue   ?? [],
        overdue:   cached.content?.overdue ?? [],
        summary:   cached.content?.summary ?? null,
        historyId: cached.id,
        cached:    true,
        cachedAt:  cached.created_at,
        model:     cached.model,
      });
    }
  }

  // ── Build Claude prompt ─────────────────────────────────────────────────────
  const dateStr = now.toLocaleDateString('en-US', { timeZone: userTz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: userTz, hour: '2-digit', minute: '2-digit' });

  // Category priorities
  const categoryPrioritiesText = categoryWeights
    .map(w => `  ${w.category}: ${w.weight.toFixed(1)}`)
    .join('\n');

  // Structured availability (replaces raw calendar event list)
  const availabilityText = buildAvailabilityText(calendarRows, prefs, activeRejections, now, userTz);

  // Task lines (with category)
  const taskLines = openTasks.map(t => {
    const priority = TASK_PRIORITY[t.priority] ?? 'medium';
    const parts    = [`- [task:${t.id}] "${t.title}" priority:${priority}`];
    if (t.deadline) {
      const daysUntil = Math.round((new Date(t.deadline) - now) / (1000 * 60 * 60 * 24));
      parts.push(`deadline:${daysUntil < 0 ? 'OVERDUE' : daysUntil === 0 ? 'today' : `${daysUntil}d`}`);
    }
    if (t.time_required_minutes) parts.push(`est:${t.time_required_minutes}min`);
    if (t.category)              parts.push(`category:${t.category}`);
    return parts.join(' ');
  }).join('\n');

  // Beads section: hierarchy when parent data is available, flat list otherwise.
  const hasHierarchyData = beadsReady.some(b => b.parent_feature_id);
  let beadsLines;
  if (hasHierarchyData) {
    const featureMap = new Map();
    const standalone = [];
    for (const b of beadsReady) {
      if (b.parent_feature_id) {
        if (!featureMap.has(b.parent_feature_id)) {
          featureMap.set(b.parent_feature_id, { title: b.parent_feature_title, priority: b.parent_priority, tasks: [] });
        }
        featureMap.get(b.parent_feature_id).tasks.push(b);
      } else {
        standalone.push(b);
      }
    }
    const featureGroups = [...featureMap.entries()].sort(([, a], [, b]) => (a.priority ?? 99) - (b.priority ?? 99));
    const lines = [];
    for (const [, { title, priority, tasks }] of featureGroups) {
      lines.push(`Feature: "${title}" [${priority !== null ? `P${priority}` : 'P?'}]`);
      tasks.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
      for (const t of tasks) {
        const active = t.status === 'in_progress' ? ' (active)' : '';
        lines.push(`  └─ [beads:${t.issue_id}] "${t.title}" ${t.priority !== null ? `P${t.priority}` : 'P2'}${active}`);
      }
    }
    if (standalone.length > 0) {
      lines.push('Standalone tasks:');
      standalone.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
      for (const b of standalone) {
        const active = b.status === 'in_progress' ? ' (active)' : '';
        lines.push(`  └─ [beads:${b.issue_id}] "${b.title}" ${b.priority !== null ? `P${b.priority}` : 'P2'}${active}`);
      }
    }
    beadsLines = lines.join('\n');
  } else {
    beadsLines = beadsReady.map(b => {
      const pri   = b.priority !== null ? `P${b.priority}` : 'P2';
      const parts = [`- [beads:${b.issue_id}] "${b.title}" priority:${pri}`];
      if (b.status === 'in_progress')             parts.push('(active)');
      if (b.issue_type && b.issue_type !== 'task') parts.push(`type:${b.issue_type}`);
      return parts.join(' ');
    }).join('\n');
  }

  const feedbackText = buildFeedbackText(feedbackRows, openTasks, beadsReady);

  const prompt = `You are a personal AI life organizer. Produce a prioritized work portfolio for the user.

Current date/time: ${dateStr} at ${timeStr} (${userTz})

CATEGORY PRIORITIES (higher weight = surface more aggressively):
${categoryPrioritiesText || '  (none configured)'}

AVAILABLE TIME (next 7 days, ${userTz}):
${availabilityText || '  (no schedule configured)'}
${feedbackText ? `\n${feedbackText}\n` : ''}
OPEN TASKS:
${taskLines || '  (none)'}

READY BEADS ISSUES (software project tasks, no blockers${hasHierarchyData ? ', grouped by feature' : ''}):
${beadsLines || '  (none)'}

Rules:
- focus: single most important item to start in the next available block. null if nothing fits.
- queue: next 3–5 items in priority order (deadline + category weight + effort fit).
- overdue: ALL tasks with deadline:OVERDUE — include every one, no window needed.
- Treat Beads priority as effort-sizing, not scheduling urgency. Use category weight + deadline to determine scheduling slot.
- When multiple Beads tasks belong to the same Feature, prefer the one that brings the Feature closest to completion.
- Items dismissed 2+ times recently: only include in focus/queue if deadline is OVERDUE or < 2 days away.
- reason must be specific and ≤8 words (e.g. "overdue — 3 days late", "open 2h block today", "last task before Feature closes").
- window: reference a specific block from AVAILABLE TIME (e.g. "10:00-12:00" or "Thu 09:00-11:30"). Omit if unclear.

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "focus": { "ref": "task:123", "reason": "overdue — 3 days late", "window": "15:00-17:30" },
  "queue": [
    { "ref": "beads:life-abc", "reason": "last task before feature closes", "window": "Thu 09:00-11:30" }
  ],
  "overdue": [
    { "ref": "task:456", "reason": "3 days late" }
  ],
  "summary": "One sentence on what the user should focus on today."
}`;

  // ── Call Claude ─────────────────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let claudeText = '';
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    const message = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      messages:   [{ role: 'user', content: prompt }],
    });
    claudeText       = message.content[0]?.text || '';
    promptTokens     = message.usage?.input_tokens  || 0;
    completionTokens = message.usage?.output_tokens || 0;
    console.log(`[recommend] Claude responded (${promptTokens}+${completionTokens} tokens)`);
  } catch (e) {
    console.error('[recommend] Anthropic API error:', e.message);
    return json({ error: `AI service unavailable: ${e.message}` }, 503);
  }

  // ── Parse Claude response ───────────────────────────────────────────────────
  let parsed;
  try {
    const clean = claudeText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(clean);
  } catch (e) {
    console.error('[recommend] Unparseable Claude response:', claudeText);
    return json({ error: 'AI returned an unparseable response — please try again.' }, 500);
  }

  // ── Resolve refs → full task objects ───────────────────────────────────────
  const focus  = parsed.focus
    ? resolveRef(parsed.focus.ref, parsed.focus.reason, parsed.focus.window, openTasks, beadsReady)
    : null;
  const queue  = (parsed.queue   ?? [])
    .map(item => resolveRef(item.ref, item.reason, item.window, openTasks, beadsReady))
    .filter(Boolean);
  const overdue = (parsed.overdue ?? [])
    .map(item => resolveRef(item.ref, item.reason, null, openTasks, beadsReady))
    .filter(Boolean);

  // ── Persist to recommendation_history ──────────────────────────────────────
  const contentToStore  = { focus, queue, overdue, summary: parsed.summary || null };
  const snapshotToStore = {
    hash:        currentHash,
    beadsCount:  beadsReady.length,
    tasksCount:  openTasks.length,
    generatedAt: now.toISOString(),
  };

  const { data: insertedRow, error: insertErr } = await supabase
    .from('recommendation_history')
    .insert({
      user_id:              userId,
      content:              contentToStore,
      world_state_snapshot: snapshotToStore,
      model:                MODEL,
      prompt_tokens:        promptTokens,
      completion_tokens:    completionTokens,
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error('[recommend] Failed to write recommendation_history:', insertErr.message);
  }

  return json({
    focus,
    queue,
    overdue,
    summary:   parsed.summary || null,
    historyId: insertedRow?.id ?? null,
    cached:    false,
    cachedAt:  null,
    model:     MODEL,
    tokens:    { prompt: promptTokens, completion: completionTokens },
  });
};
