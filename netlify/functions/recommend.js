// Context Reasoner — on-demand Claude recommendations (life-tm6)
//
// POST (or GET) /.netlify/functions/recommend
//
// Returns ranked task recommendations from Claude, based on the current World State.
// Caches for 30 min when the world state hasn't changed (same set of task/issue IDs).
//
// Response shape:
//   {
//     recommendations: [{id, beadsId?, title, source, sourceUrl, priority,
//                        deadline, timeRequired, reason}],
//     summary: string,   // one sentence from Claude on what to focus on
//     cached: bool,
//     cachedAt: ISO string | null,
//     model: string,
//   }
//
// Error shape:
//   { error: string }  with appropriate HTTP status
//
// Env vars required (Netlify dashboard → Environment variables):
//   ANTHROPIC_API_KEY           Anthropic API key (functions scope)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_USER_ID

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MODEL        = 'claude-haiku-4-5-20251001';
const MAX_TOKENS   = 1024;

// Beads priority int → UI string (0=critical treated as high)
const BEADS_PRIORITY = { 0: 'high', 1: 'high', 2: 'medium', 3: 'low', 4: 'low' };
// open_tasks priority int → UI string
const TASK_PRIORITY  = { 0: 'high', 1: 'high', 2: 'medium', 3: 'low', 4: 'low' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Stable hash of the world state — just the set of IDs, sorted. */
function worldStateHash(beadsReady, openTasks) {
  const beadsIds = beadsReady.map(b => b.issue_id).sort().join(',');
  const taskIds  = openTasks.map(t => String(t.id)).sort().join(',');
  return `b:${beadsIds}|t:${taskIds}`;
}

export default async () => {
  // ── Validate env ────────────────────────────────────────────────────────────
  const missing = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_USER_ID']
    .filter(k => !process.env[k]);
  if (missing.length) {
    console.error('[recommend] Missing env vars:', missing.join(', '));
    return json({ error: `Missing configuration: ${missing.join(', ')}` }, 500);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const userId   = process.env.SUPABASE_USER_ID;
  const now      = new Date();

  // ── Read world state from Supabase ──────────────────────────────────────────
  const [beadsResult, tasksResult, prefsResult] = await Promise.all([
    supabase
      .from('beads_ready')
      .select('*')
      .eq('user_id', userId)
      .order('priority', { ascending: true }),
    supabase
      .from('open_tasks')
      .select('id,title,priority,deadline,status,source,source_url,time_required_minutes')
      .eq('user_id', userId)
      .not('status', 'in', '(completed,cancelled)')
      .order('deadline', { ascending: true, nullsFirst: false }),
    supabase
      .from('user_preferences')
      .select('timezone')
      .eq('user_id', userId)
      .single(),
  ]);

  // User's IANA timezone (e.g. 'America/Toronto'). Fall back to UTC if missing.
  const userTz = prefsResult.data?.timezone || 'UTC';

  // Local date string in user's timezone (YYYY-MM-DD) — used to query the right calendar rows.
  const localDateStr = now.toLocaleDateString('en-CA', { timeZone: userTz });

  const calendarResult = await supabase
    .from('calendar_snapshot')
    .select('event_date,events')
    .eq('user_id', userId)
    .gte('event_date', localDateStr)
    .order('event_date', { ascending: true })
    .limit(7);

  const beadsReady   = beadsResult.data   || [];
  const openTasks    = tasksResult.data   || [];
  const calendarRows = calendarResult.data || [];

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (beadsReady.length === 0 && openTasks.length === 0) {
    return json({
      recommendations: [],
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
      console.log('[recommend] Cache hit — returning cached result');
      return json({
        recommendations: cached.content?.recommendations || [],
        summary:         cached.content?.summary         || null,
        cached:    true,
        cachedAt:  cached.created_at,
        model:     cached.model,
      });
    }
  }

  // ── Build Claude prompt ─────────────────────────────────────────────────────
  const dateStr = now.toLocaleDateString('en-US', { timeZone: userTz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: userTz, hour: '2-digit', minute: '2-digit' });

  const taskLines = openTasks.map(t => {
    const priority = TASK_PRIORITY[t.priority] ?? 'medium';
    const parts    = [`- [task:${t.id}] "${t.title}" priority:${priority}`];
    if (t.deadline) {
      const daysUntil = Math.round((new Date(t.deadline) - now) / (1000 * 60 * 60 * 24));
      const label     = daysUntil < 0 ? 'OVERDUE' : daysUntil === 0 ? 'today' : `${daysUntil}d`;
      parts.push(`deadline:${label}`);
    }
    if (t.time_required_minutes) parts.push(`est:${t.time_required_minutes}min`);
    return parts.join(' ');
  }).join('\n');

  const beadsLines = beadsReady.map(b => {
    const pri   = b.priority !== null ? `P${b.priority}` : 'P2';
    const parts = [`- [beads:${b.issue_id}] "${b.title}" priority:${pri}`];
    if (b.status === 'in_progress') parts.push('(active)');
    if (b.issue_type && b.issue_type !== 'task') parts.push(`type:${b.issue_type}`);
    return parts.join(' ');
  }).join('\n');

  const calendarLines = calendarRows.map(row => {
    const raw = Array.isArray(row.events) ? row.events : [];
    // Deduplicate by event id — same event can appear from both Google and Apple sources.
    const seen = new Set();
    const evs  = raw.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
    const evStr = evs.map(e => {
      // Prefer ISO strings so we can format in user's timezone; fall back to stored HH:MM.
      const startLabel = e.startISO
        ? new Date(e.startISO).toLocaleTimeString('en-US', { timeZone: userTz, hour: '2-digit', minute: '2-digit', hour12: false })
        : (e.start ?? '');
      const endLabel = e.endISO
        ? new Date(e.endISO).toLocaleTimeString('en-US', { timeZone: userTz, hour: '2-digit', minute: '2-digit', hour12: false })
        : (e.end ?? '');
      return `${startLabel}–${endLabel} ${e.title ?? ''}`;
    }).join(', ');
    return `  ${row.event_date}: ${evStr || 'free'}`;
  }).join('\n');

  const prompt = `You are a personal AI life organizer. Recommend the 3 most important tasks for the user to work on RIGHT NOW, in priority order.

Current date/time: ${dateStr} at ${timeStr} (${userTz})

OPEN TASKS:
${taskLines || '  (none)'}

READY BEADS ISSUES (software project tasks, no blockers):
${beadsLines || '  (none)'}

UPCOMING CALENDAR (next 7 days, times in ${userTz}):
${calendarLines || '  (none)'}

Rules:
- Overdue tasks must always appear if any exist
- If Beads issues are present, include at least one unless all are P3/P4 (low/backlog)
- Calendar context matters: prefer short tasks when the day is packed, longer ones during free blocks
- Reason must be specific and ≤8 words (e.g. "overdue — 3 days late", "due tomorrow", "quick 15-min win", "open focus block this afternoon")

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "recommendations": [
    { "ref": "task:123",        "reason": "short reason" },
    { "ref": "beads:life-abc",  "reason": "short reason" }
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
    claudeText        = message.content[0]?.text || '';
    promptTokens      = message.usage?.input_tokens     || 0;
    completionTokens  = message.usage?.output_tokens    || 0;
    console.log(`[recommend] Claude responded (${promptTokens}+${completionTokens} tokens)`);
  } catch (e) {
    console.error('[recommend] Anthropic API error:', e.message);
    return json({ error: `AI service unavailable: ${e.message}` }, 503);
  }

  // ── Parse response ──────────────────────────────────────────────────────────
  let parsed;
  try {
    const clean = claudeText
      .replace(/^```(?:json)?\s*/,  '')
      .replace(/\s*```$/,           '')
      .trim();
    parsed = JSON.parse(clean);
  } catch (e) {
    console.error('[recommend] Unparseable Claude response:', claudeText);
    return json({ error: 'AI returned an unparseable response — please try again.' }, 500);
  }

  // ── Resolve refs → full task objects ───────────────────────────────────────
  const recommendations = (parsed.recommendations || []).flatMap(({ ref, reason }) => {
    if (!ref) return [];

    if (ref.startsWith('task:')) {
      const id   = parseInt(ref.replace('task:', ''), 10);
      const task = openTasks.find(t => t.id === id);
      if (!task) { console.warn(`[recommend] ref ${ref} not found in openTasks`); return []; }
      return [{
        id:           task.id,
        title:        task.title,
        source:       task.source    || 'manual',
        sourceUrl:    task.source_url || null,
        priority:     TASK_PRIORITY[task.priority] ?? 'medium',
        deadline:     task.deadline  || null,
        timeRequired: task.time_required_minutes || null,
        reason,
      }];
    }

    if (ref.startsWith('beads:')) {
      const issueId = ref.replace('beads:', '');
      const bead    = beadsReady.find(b => b.issue_id === issueId);
      if (!bead) { console.warn(`[recommend] ref ${ref} not found in beadsReady`); return []; }
      return [{
        id:           bead.id,
        beadsId:      bead.issue_id,
        title:        bead.title,
        source:       'beads',
        sourceUrl:    null,
        priority:     BEADS_PRIORITY[bead.priority] ?? 'medium',
        deadline:     null,
        timeRequired: null,
        reason,
      }];
    }

    console.warn(`[recommend] Unknown ref format: ${ref}`);
    return [];
  });

  // ── Persist to recommendation_history ──────────────────────────────────────
  const contentToStore = { recommendations, summary: parsed.summary || null };
  const snapshotToStore = {
    hash:       currentHash,
    beadsCount: beadsReady.length,
    tasksCount: openTasks.length,
    generatedAt: now.toISOString(),
  };

  const { error: insertErr } = await supabase
    .from('recommendation_history')
    .insert({
      user_id:              userId,
      content:              contentToStore,
      world_state_snapshot: snapshotToStore,
      model:                MODEL,
      prompt_tokens:        promptTokens,
      completion_tokens:    completionTokens,
    });

  if (insertErr) {
    // Non-fatal — still return recommendations
    console.error('[recommend] Failed to write recommendation_history:', insertErr.message);
  }

  return json({
    recommendations,
    summary:  parsed.summary || null,
    cached:   false,
    cachedAt: null,
    model:    MODEL,
    tokens:   { prompt: promptTokens, completion: completionTokens },
  });
};
