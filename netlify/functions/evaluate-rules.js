// evaluate-rules — deterministic Rules Engine for the Life Organizer.
//
// Reads enabled rules from Supabase, evaluates each condition against the
// current World State, checks cooldowns, writes matches to notification_log,
// and returns the fired notifications.
//
// No AI involved. Pure condition evaluation against structured data.
// (Context Reasoner / Pattern Analyzer are the AI nodes — not this.)
//
// Called by the PWA on: app open, manual refresh.
// Future: also called by a scheduled Netlify cron (hourly sweep).
//
// Supported condition_type values (4 seed rules):
//   deadline_proximity — task.deadline within warn window and not completed
//   issue_unblocked    — beads issue appears in ready list for the first time
//   task_stalled       — in-progress/pending task hasn't changed in N days,
//                        deadline within Y days
//   open_block         — calendar free gap covers a ready high-priority task
//                        (skipped gracefully when no calendar data)
//
// Returns: { fired: [...], evaluated_at: ISO }

import { createClient } from '@supabase/supabase-js';
import { computeFreeBlocks } from '../lib/freeBlocks.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const USER_ID = process.env.SUPABASE_USER_ID;

// ─── Condition evaluators ────────────────────────────────────────────────────
// Each returns an array of match objects: { title, body, payload, channel }
// An empty array means "no match".

function evalDeadlineProximity(rule, { openTasks }) {
  const {
    warn_hours        = [24, 4],
    statuses_to_check = ['pending', 'in_progress'],
    priority_max,
  } = rule.condition_config;

  const now      = Date.now();
  const maxHours = Math.max(...warn_hours);
  const cutoff   = now + maxHours * 3_600_000;

  return openTasks
    .filter(t => {
      if (!statuses_to_check.includes(t.status)) return false;
      if (!t.deadline) return false;
      const deadlineMs = new Date(t.deadline).getTime();
      if (deadlineMs <= now)    return false; // already overdue
      if (deadlineMs > cutoff)  return false; // outside warning window
      // Priority gate: suppress long-horizon warnings (> 48h) for low-priority tasks.
      if (priority_max != null) {
        const hoursLeft = (deadlineMs - now) / 3_600_000;
        if (hoursLeft > 48 && (t.priority ?? 4) > priority_max) return false;
      }
      return true;
    })
    .map(t => {
      const hoursLeft = Math.round((new Date(t.deadline).getTime() - now) / 3_600_000);
      const label = hoursLeft <= (Math.min(...warn_hours)) ? 'today' : 'tomorrow';
      return {
        title:   `Deadline ${label}: ${t.title}`,
        body:    `${hoursLeft}h remaining`,
        payload: { task_id: t.id, task_title: t.title, deadline: t.deadline, hours_left: hoursLeft },
      };
    });
}

function evalIssueUnblocked(rule, { beadsReady }, alreadyNotifiedIssueIds) {
  const { priority_max = 1 } = rule.condition_config;

  return beadsReady
    .filter(issue =>
      (issue.priority ?? 4) <= priority_max &&
      !alreadyNotifiedIssueIds.has(issue.issue_id),
    )
    .map(issue => ({
      title:   `${issue.issue_id} is now ready to claim`,
      body:    issue.title,
      payload: { issue_id: issue.issue_id, issue_title: issue.title, priority: issue.priority },
    }));
}

function evalTaskStalled(rule, { openTasks }) {
  const {
    stall_days            = 3,
    deadline_within_days  = 14,
    statuses_to_check     = ['in_progress', 'pending'],
  } = rule.condition_config;

  const now           = Date.now();
  const stalledBefore = now - stall_days * 86_400_000;
  const deadlineCutoff = now + deadline_within_days * 86_400_000;

  return openTasks
    .filter(t =>
      statuses_to_check.includes(t.status) &&
      t.deadline &&
      new Date(t.deadline).getTime() <= deadlineCutoff &&
      new Date(t.updated_at).getTime() <= stalledBefore,
    )
    .map(t => {
      const daysLeft = Math.round((new Date(t.deadline).getTime() - now) / 86_400_000);
      const stalledDays = Math.round((now - new Date(t.updated_at).getTime()) / 86_400_000);
      return {
        title:   `Stalled: ${t.title}`,
        body:    `${stalledDays}d without progress · ${daysLeft}d until deadline`,
        payload: { task_id: t.id, task_title: t.title, stalled_days: stalledDays, days_left: daysLeft },
      };
    });
}

function evalOpenBlock(rule, { calendarSnapshot, openTasks, beadsReady, prefs, activeRejections, userTz, today }) {
  if (!calendarSnapshot || calendarSnapshot.length === 0) return [];

  const {
    min_block_minutes  = 30,
    match_priority_max = 1,
    sources            = ['open_tasks', 'beads_ready'],
  } = rule.condition_config;

  const candidates = [
    ...(sources.includes('open_tasks')
      ? openTasks.filter(t => t.status === 'pending' && (t.priority ?? 4) <= match_priority_max)
      : []),
    ...(sources.includes('beads_ready')
      ? beadsReady.filter(i => (i.priority ?? 4) <= match_priority_max)
      : []),
  ];
  if (candidates.length === 0) return [];

  const todaySnap = calendarSnapshot.find(s => s.event_date === today);
  const raw       = Array.isArray(todaySnap?.events) ? todaySnap.events : [];
  const events    = raw
    .map(e => ({ start: e.startISO ?? e.start, end: e.endISO ?? e.end }))
    .filter(e => e.start && e.end);

  const allBlocks = computeFreeBlocks(
    events,
    prefs?.weekly_schedule    ?? [],
    prefs?.schedule_exceptions ?? [],
    prefs?.planning_window    ?? null,
    activeRejections ?? [],
    today,
    userTz,
  );

  // Only blocks that haven't ended yet and meet the rule's minimum size.
  const nowMs  = Date.now();
  const blocks = allBlocks.filter(b =>
    new Date(b.endISO).getTime() > nowMs &&
    b.durationMinutes >= min_block_minutes,
  );
  if (blocks.length === 0) return [];

  const matches = [];
  for (const block of blocks) {
    const fitting = candidates.filter(t =>
      t.time_required_minutes && t.time_required_minutes <= block.durationMinutes,
    );
    for (const task of fitting.slice(0, 1)) {  // one notification per block
      const s   = new Date(block.startISO).toLocaleTimeString('en-US', { timeZone: userTz, hour: '2-digit', minute: '2-digit', hour12: false });
      const e   = new Date(block.endISO).toLocaleTimeString('en-US', { timeZone: userTz, hour: '2-digit', minute: '2-digit', hour12: false });
      const win = `${s}–${e}`;
      matches.push({
        title:   `${win} free — ${task.title ?? task.issue_id} fits`,
        body:    `${task.time_required_minutes}m task · ${block.durationMinutes}m available`,
        payload: { gap_minutes: block.durationMinutes, start_iso: block.startISO, task_id: task.id ?? task.issue_id },
      });
    }
  }
  return matches;
}

const EVALUATORS = {
  deadline_proximity: evalDeadlineProximity,
  issue_unblocked:    evalIssueUnblocked,
  task_stalled:       evalTaskStalled,
  open_block:         evalOpenBlock,
};

// ─── Main handler ────────────────────────────────────────────────────────────

export default async () => {
  if (!USER_ID) {
    return json(500, { error: 'SUPABASE_USER_ID not configured' });
  }

  // 1. Load enabled rules
  const { data: rules, error: rulesErr } = await supabase
    .from('rules')
    .select('*')
    .eq('user_id', USER_ID)
    .is('deprecated_at', null);
  if (rulesErr) return json(500, { error: rulesErr.message });
  if (!rules?.length) return json(200, { fired: [], evaluated_at: new Date().toISOString() });

  // 2. Load World State
  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const [
    { data: beadsReady  },
    { data: openTasks   },
    { data: calSnap     },
    { data: prefsData   },
    { data: rejections  },
  ] = await Promise.all([
    supabase.from('beads_ready').select('*').eq('user_id', USER_ID),
    supabase.from('open_tasks').select('*').eq('user_id', USER_ID)
      .not('status', 'in', '(completed,cancelled)'),
    supabase.from('calendar_snapshot').select('*').eq('user_id', USER_ID)
      .gte('event_date', today).lte('event_date', tomorrow),
    supabase.from('user_preferences')
      .select('timezone,weekly_schedule,schedule_exceptions,planning_window')
      .eq('user_id', USER_ID).single(),
    supabase.from('block_rejections')
      .select('day_of_week,start_time,end_time,released_at')
      .eq('user_id', USER_ID).is('released_at', null),
  ]);

  const prefs  = prefsData ?? {};
  const userTz = prefs.timezone ?? 'UTC';

  const worldState = {
    beadsReady:       beadsReady  ?? [],
    openTasks:        openTasks   ?? [],
    calendarSnapshot: calSnap     ?? [],
    prefs,
    activeRejections: rejections  ?? [],
    userTz,
    today,
  };

  // 3. For issue_unblocked: pre-load all previously notified issue IDs
  //    (per-issue "already fired" check, not a time-based cooldown)
  const issueUnblockedRule = rules.find(r => r.condition_type === 'issue_unblocked');
  let alreadyNotifiedIssueIds = new Set();
  if (issueUnblockedRule) {
    const { data: prevLog } = await supabase
      .from('notification_log')
      .select('payload')
      .eq('user_id', USER_ID)
      .eq('rule_id', issueUnblockedRule.id);
    alreadyNotifiedIssueIds = new Set(
      (prevLog ?? []).map(n => n.payload?.issue_id).filter(Boolean),
    );
  }

  // 4. Evaluate each rule
  const now = new Date().toISOString();
  const toInsert = [];

  for (const rule of rules) {
    const evaluator = EVALUATORS[rule.condition_type];
    if (!evaluator) continue;

    // Cooldown check (not applied to issue_unblocked — it uses per-issue tracking above)
    if (rule.condition_type !== 'issue_unblocked') {
      const cooldownStart = new Date(Date.now() - rule.cooldown_minutes * 60_000).toISOString();
      const { data: recentLog } = await supabase
        .from('notification_log')
        .select('id')
        .eq('user_id', USER_ID)
        .eq('rule_id', rule.id)
        .gte('fired_at', cooldownStart)
        .limit(1);
      if (recentLog?.length > 0) continue;  // still in cooldown
    }

    // Evaluate
    const matches = rule.condition_type === 'issue_unblocked'
      ? evaluator(rule, worldState, alreadyNotifiedIssueIds)
      : evaluator(rule, worldState);

    const channels = Array.isArray(rule.notification_channels) && rule.notification_channels.length
      ? rule.notification_channels
      : ['in_app'];

    for (const match of matches) {
      for (const ch of channels) {
        toInsert.push({
          user_id:  USER_ID,
          rule_id:  rule.id,
          channel:  ch,
          title:    match.title,
          body:     match.body ?? null,
          payload:  match.payload ?? null,
          fired_at: now,
        });
      }
    }
  }

  // 5. Write to notification_log, capture inserted ids for dismiss write-back
  let insertedIds = [];
  if (toInsert.length > 0) {
    const { data: inserted, error: logErr } = await supabase
      .from('notification_log')
      .insert(toInsert)
      .select('id');
    if (logErr) console.error('[evaluate-rules] notification_log insert failed:', logErr.message);
    insertedIds = inserted ?? [];
  }

  return json(200, {
    fired: toInsert.map(({ rule_id, channel, title, body, payload }, i) => ({
      id: insertedIds[i]?.id ?? null,
      rule_id, channel, title, body, payload,
    })),
    evaluated_at: now,
  });
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
