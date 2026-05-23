// CRUD endpoint for open_tasks — the PWA's manual task store.
//
// Routes (single-user system, SUPABASE_USER_ID is the implicit owner):
//   GET    /.netlify/functions/tasks
//     → { tasks: Task[] }  all tasks, ordered deadline asc (nulls last), then created_at desc
//
//   POST   /.netlify/functions/tasks
//     body: { title, category?, priority?, timeRequired?, deadline?, source?, sourceUrl? }
//     → { task: Task }
//
//   PATCH  /.netlify/functions/tasks?id=<id>
//     body: { status?, title?, priority?, category?, timeRequired?, deadline? }
//     → { task: Task }
//
//   DELETE /.netlify/functions/tasks?id=<id>
//     → { ok: true }
//
// Priority mapping (UI ↔ DB):
//   'high'   ↔ 1   (DB 0 also maps to 'high' on read)
//   'medium' ↔ 2
//   'low'    ↔ 3   (DB 4 also maps to 'low' on read)
//
// Category note:
//   The `category` column requires migration 20260522100000_open_tasks_add_category.sql.
//   Until that migration is applied, category is stored and returned as 'general'.
//
// Env vars required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID

import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_USER_ID,
} = process.env;

// ─── Priority helpers ────────────────────────────────────────────────────────

const PRIORITY_TO_INT = { high: 1, medium: 2, low: 3 };
const PRIORITY_FROM_INT = { 0: 'high', 1: 'high', 2: 'medium', 3: 'low', 4: 'low' };

// ─── Shape conversion ─────────────────────────────────────────────────────────

/** Supabase DB row → UI task shape */
function fromDbRow(row) {
  return {
    id:           row.id,
    title:        row.title,
    category:     row.category   || 'general',
    status:       row.status,
    priority:     PRIORITY_FROM_INT[row.priority] ?? 'medium',
    timeRequired: row.time_required_minutes ?? null,
    deadline:     row.deadline   ?? null,
    source:            row.source              || 'manual',
    sourceUrl:         row.source_url          ?? null,
    createdAt:         row.created_at,
    completedAt:       row.completed_at        ?? null,
    calendarEventUrl:  row.calendar_event_url  ?? null,
  };
}

/**
 * UI task shape → DB insert/update payload.
 *
 * `category` is omitted when it would cause a "column does not exist" error
 * (i.e., before the migration has been applied). The DB column default 'general'
 * covers that case. Once the migration runs, category will be persisted correctly.
 */
function toDbInsert(task, { hasCategory, hasCalendarEventUrl }) {
  const row = {
    user_id:               SUPABASE_USER_ID,
    title:                 task.title,
    status:                task.status                    || 'pending',
    priority:              PRIORITY_TO_INT[task.priority] ?? 2,
    time_required_minutes: task.timeRequired               || null,
    deadline:              task.deadline                   || null,
    source:                task.source                     || 'manual',
    source_url:            task.sourceUrl                  || null,
  };
  if (hasCategory)         row.category           = task.category           || 'general';
  if (hasCalendarEventUrl) row.calendar_event_url = task.calendarEventUrl   || null;
  return row;
}

function toDbPatch(updates, { hasCategory, hasCalendarEventUrl }) {
  const row = {};
  if (updates.title    != null) row.title    = updates.title;
  if (updates.status   != null) row.status   = updates.status;
  if (updates.priority != null) row.priority = PRIORITY_TO_INT[updates.priority] ?? 2;
  if (updates.timeRequired !== undefined) row.time_required_minutes = updates.timeRequired || null;
  if (updates.deadline !== undefined)     row.deadline = updates.deadline || null;
  if (hasCategory         && updates.category         != null) row.category           = updates.category;
  if (hasCalendarEventUrl && updates.calendarEventUrl !== undefined) row.calendar_event_url = updates.calendarEventUrl || null;

  // Set completed_at when marking a task done
  if (updates.status === 'completed') row.completed_at = new Date().toISOString();

  return row;
}

// ─── Response helper ──────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Column probes ────────────────────────────────────────────────────────────
// Check once per invocation whether optional columns exist (graceful until migrations run).

async function probeColumn(supabase, column) {
  const { error } = await supabase
    .from('open_tasks')
    .select(column)
    .eq('user_id', SUPABASE_USER_ID)
    .limit(1);
  return !error || error.code !== '42703';
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async (req) => {
  const url    = new URL(req.url);
  const method = req.method;

  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Probe for optional columns added by later migrations
  const [hasCategory, hasCalendarEventUrl] = await Promise.all([
    probeColumn(supabase, 'category'),
    probeColumn(supabase, 'calendar_event_url'),
  ]);

  // ── GET — list all tasks ─────────────────────────────────────────────────────
  if (method === 'GET') {
    // Build select list from available columns — avoids errors when optional migrations haven't run yet
    const base = 'id,title,status,priority,time_required_minutes,deadline,source,source_url,created_at,completed_at';
    const extras = [hasCategory && 'category', hasCalendarEventUrl && 'calendar_event_url'].filter(Boolean);
    const select = extras.length ? `${base},${extras.join(',')}` : base;
    const { data, error } = await supabase
      .from('open_tasks')
      .select(select)
      .eq('user_id', SUPABASE_USER_ID)
      .order('deadline',    { ascending: true,  nullsFirst: false })
      .order('created_at',  { ascending: false });

    if (error) {
      console.error('[tasks] GET failed:', error.message);
      return json({ error: 'Failed to load tasks' }, 500);
    }

    return json({ tasks: (data ?? []).map(fromDbRow) });
  }

  // ── POST — create task ───────────────────────────────────────────────────────
  if (method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400); }

    if (!body.title?.trim()) return json({ error: 'title is required' }, 400);

    const { data, error } = await supabase
      .from('open_tasks')
      .insert(toDbInsert(body, { hasCategory, hasCalendarEventUrl }))
      .select()
      .single();

    if (error) {
      console.error('[tasks] POST failed:', error.message);
      return json({ error: 'Failed to create task' }, 500);
    }

    return json({ task: fromDbRow(data) }, 201);
  }

  // ── PATCH — update task ──────────────────────────────────────────────────────
  if (method === 'PATCH') {
    const id = parseInt(url.searchParams.get('id'), 10);
    if (!id) return json({ error: 'id query param required' }, 400);

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400); }

    const patch = toDbPatch(body, { hasCategory, hasCalendarEventUrl });
    if (Object.keys(patch).length === 0) {
      return json({ error: 'No valid fields to update' }, 400);
    }

    const { data, error } = await supabase
      .from('open_tasks')
      .update(patch)
      .eq('id', id)
      .eq('user_id', SUPABASE_USER_ID)
      .select()
      .single();

    if (error) {
      console.error('[tasks] PATCH failed:', error.message);
      return json({ error: 'Failed to update task' }, 500);
    }

    return json({ task: fromDbRow(data) });
  }

  // ── DELETE — delete task ─────────────────────────────────────────────────────
  if (method === 'DELETE') {
    const id = parseInt(url.searchParams.get('id'), 10);
    if (!id) return json({ error: 'id query param required' }, 400);

    const { error } = await supabase
      .from('open_tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', SUPABASE_USER_ID);

    if (error) {
      console.error('[tasks] DELETE failed:', error.message);
      return json({ error: 'Failed to delete task' }, 500);
    }

    return json({ ok: true });
  }
};
