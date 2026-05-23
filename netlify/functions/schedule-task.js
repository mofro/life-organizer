// Creates a Google Calendar event from an open_tasks row and stores the event
// URL back on the task. Returns the created event details.
//
// POST /.netlify/functions/schedule-task
// body: { taskId: number, startIso?: string }
//   taskId   — id of the open_tasks row to schedule
//   startIso — ISO datetime string for event start (optional; defaults to next full hour)
//
// Response: { event: { id, htmlLink, start, end }, calendarEventUrl: string }
//
// If the calendar_event_url column hasn't been migrated yet the event is still
// created — it just won't be persisted back to the task row.
//
// Env vars required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID

import { createClient } from '@supabase/supabase-js';

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_USER_ID,
} = process.env;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Returns the start of the next full hour from now. */
function nextFullHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Returns true if the calendar_event_url column exists on open_tasks. */
async function probeCalendarEventUrl(supabase) {
  const { error } = await supabase
    .from('open_tasks')
    .select('calendar_event_url')
    .eq('user_id', SUPABASE_USER_ID)
    .limit(1);
  return !error || error.code !== '42703';
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { taskId, startIso } = body;
  if (!taskId) return json({ error: 'taskId is required' }, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── 1. Fetch the task ────────────────────────────────────────────────────────
  const { data: task, error: taskErr } = await supabase
    .from('open_tasks')
    .select('title, time_required_minutes')
    .eq('id', taskId)
    .eq('user_id', SUPABASE_USER_ID)
    .single();

  if (taskErr || !task) {
    return json({ error: 'Task not found' }, 404);
  }

  // ── 2. Get Google refresh token ──────────────────────────────────────────────
  const { data: prefs, error: prefsErr } = await supabase
    .from('user_preferences')
    .select('google_refresh_token')
    .eq('user_id', SUPABASE_USER_ID)
    .single();

  if (prefsErr || !prefs?.google_refresh_token) {
    return json({ error: 'Google not connected — authorize via Settings first' }, 400);
  }

  // ── 3. Exchange refresh token for access token ───────────────────────────────
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: prefs.google_refresh_token,
      grant_type:    'refresh_token',
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error('[schedule-task] Token refresh failed:', errBody);
    return json({ error: 'token_refresh_failed' }, 502);
  }

  const { access_token } = await tokenRes.json();

  // ── 4. Compute start / end ───────────────────────────────────────────────────
  const start       = startIso ? new Date(startIso) : nextFullHour();
  const durationMin = task.time_required_minutes || 30;
  const end         = new Date(start.getTime() + durationMin * 60 * 1000);

  // ── 5. Create Google Calendar event ─────────────────────────────────────────
  const eventRes = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary:     task.title,
        description: 'Scheduled from Life Organizer',
        start: { dateTime: start.toISOString() },
        end:   { dateTime: end.toISOString()   },
      }),
    },
  );

  if (!eventRes.ok) {
    const errBody = await eventRes.text();
    console.error('[schedule-task] Calendar API error:', errBody);
    return json({ error: 'calendar_create_failed' }, 502);
  }

  const event = await eventRes.json();
  console.log(`[schedule-task] Created event "${task.title}" → ${event.htmlLink}`);

  // ── 6. Persist event URL back to the task (if column exists) ─────────────────
  const hasColumn = await probeCalendarEventUrl(supabase);
  if (hasColumn) {
    const { error: updateErr } = await supabase
      .from('open_tasks')
      .update({ calendar_event_url: event.htmlLink })
      .eq('id', taskId)
      .eq('user_id', SUPABASE_USER_ID);

    if (updateErr) {
      console.error('[schedule-task] Failed to persist event URL:', updateErr.message);
      // Non-fatal — the event was still created; just return without the persisted URL
    }
  } else {
    console.warn('[schedule-task] calendar_event_url column not found — run migration 20260523000000');
  }

  return json({
    event: {
      id:       event.id,
      htmlLink: event.htmlLink,
      start:    event.start.dateTime,
      end:      event.end.dateTime,
    },
    calendarEventUrl: event.htmlLink,
  });
};
