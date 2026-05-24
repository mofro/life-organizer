// Fetches Google Calendar events for today + tomorrow, writes to calendar_snapshot,
// and returns a normalized event list to the PWA.
//
// GET /.netlify/functions/calendar-sync
// Response: { connected: boolean, events: Event[], synced_at?: string, error?: string }
//   Event: { id, title, start, end, date, type }
//   date:  'today' | 'tomorrow'
//   type:  'meeting' | 'focus' | 'event'
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

/** Extract HH:MM from a Google dateTime string like "2026-05-22T14:30:00-04:00". */
function formatTime(iso) {
  if (!iso) return null;
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

/**
 * Classify a Google Calendar event into the PWA's type system.
 * meeting — event has other attendees
 * focus   — single-person / no attendees (e.g. focus blocks, reminders)
 * event   — all-day or no start time
 */
function classifyEvent(item) {
  if (!item.start?.dateTime) return 'event'; // all-day
  const others = (item.attendees ?? []).filter(a => !a.self);
  return others.length > 0 ? 'meeting' : 'focus';
}

export default async (req) => {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── 1. Check for stored refresh token ────────────────────────────────────────
  const { data: prefs, error: dbError } = await supabase
    .from('user_preferences')
    .select('google_refresh_token')
    .eq('user_id', SUPABASE_USER_ID)
    .single();

  if (dbError || !prefs?.google_refresh_token) {
    return json({ connected: false, events: [] });
  }

  // ── 2. Exchange refresh token for a fresh access token ───────────────────────
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: prefs.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('[calendar-sync] Token refresh failed:', body);
    return json({ connected: true, error: 'token_refresh_failed', events: [] });
  }

  const { access_token } = await tokenRes.json();

  // ── 3. Fetch events: today + tomorrow ────────────────────────────────────────
  const now = new Date();
  const threeDaysOut = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: threeDaysOut.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
      }),
    { headers: { Authorization: `Bearer ${access_token}` } },
  );

  if (!calRes.ok) {
    const body = await calRes.text();
    console.error('[calendar-sync] Calendar API error:', body);
    return json({ connected: true, error: 'calendar_fetch_failed', events: [] });
  }

  const { items = [] } = await calRes.json();

  // ── 4. Normalize events for the PWA ─────────────────────────────────────────
  const todayStr    = now.toISOString().split('T')[0];
  const tomorrow    = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const events = items
    .map(item => {
      const startIso   = item.start?.dateTime || item.start?.date;
      const endIso     = item.end?.dateTime   || item.end?.date;
      const eventDate  = startIso?.split('T')[0];
      const date =
        eventDate === todayStr    ? 'today'
        : eventDate === tomorrowStr ? 'tomorrow'
        : null;

      if (!date) return null; // outside today/tomorrow window
      return {
        id:    item.id,
        title: item.summary || '(No title)',
        start: formatTime(item.start?.dateTime) ?? '00:00',
        end:   formatTime(item.end?.dateTime)   ?? '23:59',
        date,
        type:  classifyEvent(item),
      };
    })
    .filter(Boolean);

  // ── 5. Upsert to calendar_snapshot (one row per date) ───────────────────────
  const byDate = {};
  for (const item of items) {
    const startIso  = item.start?.dateTime || item.start?.date;
    const eventDate = startIso?.split('T')[0];
    if (eventDate !== todayStr && eventDate !== tomorrowStr) continue;
    if (!byDate[eventDate]) byDate[eventDate] = [];
    byDate[eventDate].push({
      id:        item.id,
      title:     item.summary || '(No title)',
      start:     item.start?.dateTime || item.start?.date,
      end:       item.end?.dateTime   || item.end?.date,
      location:  item.location ?? null,
      attendees: (item.attendees ?? []).map(a => ({ email: a.email, self: !!a.self })),
      status:    item.status,
      source:    'google',
    });
  }

  for (const [dateStr, dateEvents] of Object.entries(byDate)) {
    // Read existing snapshot so we can preserve non-Google events (e.g. source='apple')
    const { data: snap } = await supabase
      .from('calendar_snapshot')
      .select('events')
      .eq('user_id', SUPABASE_USER_ID)
      .eq('event_date', dateStr)
      .single();

    const preserved = (snap?.events ?? []).filter(e => e.source !== 'google');
    const merged    = [...preserved, ...dateEvents];

    const { error: upsertErr } = await supabase
      .from('calendar_snapshot')
      .upsert(
        { user_id: SUPABASE_USER_ID, event_date: dateStr, events: merged },
        { onConflict: 'user_id,event_date' },
      );
    if (upsertErr) {
      console.error('[calendar-sync] Snapshot upsert failed for', dateStr, upsertErr.message);
    }
  }

  return json({
    connected: true,
    events,
    synced_at: new Date().toISOString(),
  });
};
