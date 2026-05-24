// Shared calendar sync logic — imported by calendar-sync.js, ical-sync.js,
// and calendar-sync-scheduled.js.
//
// Exports:
//   syncGoogle(supabase, userId, clientId, clientSecret)
//     → { connected, synced, datesWritten, events, error? }
//   syncICal(supabase, userId)
//     → { connected, synced, datesWritten, events, error? }

import ical from 'node-ical';

const WINDOW_DAYS = 14;

// ── Google helpers ─────────────────────────────────────────────────────────────

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
function classifyGoogleEvent(item) {
  if (!item.start?.dateTime) return 'event'; // all-day
  const others = (item.attendees ?? []).filter(a => !a.self);
  return others.length > 0 ? 'meeting' : 'focus';
}

// ── iCal helpers ───────────────────────────────────────────────────────────────

function getSummary(ev) {
  if (typeof ev.summary === 'string') return ev.summary;
  if (ev.summary?.val)                return ev.summary.val;
  return '(No title)';
}

function getAttendeeCount(ev) {
  if (!ev.attendee)                    return 0;
  if (Array.isArray(ev.attendee))      return ev.attendee.length;
  if (typeof ev.attendee === 'object') return 1;
  return 0;
}

function classifyICalEvent(ev, allDay) {
  if (allDay) return 'event';
  return getAttendeeCount(ev) > 0 ? 'meeting' : 'focus';
}

/** HH:MM from an ISO string, or the fallback. */
function timeOf(iso, fallback) {
  const m = iso?.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : fallback;
}

/**
 * Convert parsed node-ical events into PWA event shape.
 * node-ical returns proper JavaScript Date objects — TZID is handled correctly.
 * All-day events have ev.start.dateOnly = true.
 */
function normalizeICalEvents(icalEvents, todayStr, windowEndStr) {
  const results = [];
  for (const ev of Object.values(icalEvents)) {
    if (ev.type !== 'VEVENT')      continue;
    if (!ev.start)                 continue;
    if (ev.status === 'CANCELLED') continue;

    const allDay   = !!ev.start.dateOnly;
    const startISO = ev.start instanceof Date ? ev.start.toISOString() : null;
    if (!startISO) continue;

    const eventDate = startISO.split('T')[0];
    if (eventDate < todayStr || eventDate > windowEndStr) continue;

    const endISO = (ev.end instanceof Date && !allDay) ? ev.end.toISOString() : null;

    results.push({
      id:       ev.uid ?? `ical-${eventDate}-${Math.random()}`,
      title:    getSummary(ev),
      start:    allDay ? '00:00' : timeOf(startISO, '00:00'),
      end:      allDay ? '23:59' : timeOf(endISO,   '23:59'),
      startISO: allDay ? null : startISO,
      endISO:   allDay ? null : endISO,
      date:     eventDate,
      type:     classifyICalEvent(ev, allDay),
    });
  }
  return results;
}

// ── Snapshot upsert helper ─────────────────────────────────────────────────────

/**
 * Merge-upsert events into calendar_snapshot for one date.
 * Preserves events from other sources (e.g. keeps 'apple' when writing 'google').
 */
async function upsertSnapshotDate(supabase, userId, dateStr, newEvents, sourceTag) {
  const { data: snap } = await supabase
    .from('calendar_snapshot')
    .select('events')
    .eq('user_id', userId)
    .eq('event_date', dateStr)
    .single();

  const preserved = (snap?.events ?? []).filter(e => e.source !== sourceTag);
  const merged    = [...preserved, ...newEvents];

  const { error } = await supabase
    .from('calendar_snapshot')
    .upsert(
      { user_id: userId, event_date: dateStr, events: merged },
      { onConflict: 'user_id,event_date' },
    );
  if (error) {
    console.error(`[calendarSync] Snapshot upsert failed for ${dateStr} (${sourceTag}):`, error.message);
  }
}

// ── syncGoogle ─────────────────────────────────────────────────────────────────

/**
 * Fetch Google Calendar events for the next WINDOW_DAYS days and write to
 * calendar_snapshot. Returns the normalized event list for the PWA.
 *
 * @returns {{ connected: boolean, synced: boolean, datesWritten: number,
 *             events: object[], error?: string }}
 */
export async function syncGoogle(supabase, userId, clientId, clientSecret) {
  // 1. Load refresh token
  const { data: prefs, error: dbErr } = await supabase
    .from('user_preferences')
    .select('google_refresh_token')
    .eq('user_id', userId)
    .single();

  if (dbErr || !prefs?.google_refresh_token) {
    return { connected: false, synced: false, datesWritten: 0, events: [] };
  }

  // 2. Exchange for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: prefs.google_refresh_token,
      grant_type:    'refresh_token',
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('[calendarSync/google] Token refresh failed:', body);
    return { connected: true, synced: false, datesWritten: 0, events: [], error: 'token_refresh_failed' };
  }

  const { access_token } = await tokenRes.json();

  // 3. Fetch events
  const now        = new Date();
  const windowEnd  = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const todayStr   = now.toISOString().split('T')[0];

  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        timeMin:       now.toISOString(),
        timeMax:       windowEnd.toISOString(),
        singleEvents:  'true',
        orderBy:       'startTime',
        maxResults:    '50',
      }),
    { headers: { Authorization: `Bearer ${access_token}` } },
  );

  if (!calRes.ok) {
    const body = await calRes.text();
    console.error('[calendarSync/google] Calendar API error:', body);
    return { connected: true, synced: false, datesWritten: 0, events: [], error: 'calendar_fetch_failed' };
  }

  const { items = [] } = await calRes.json();
  if (items.length >= 50) {
    console.warn('[calendarSync/google] 50-result cap hit — some events in the 14-day window may be missing.');
  }

  // 4. Normalize for PWA
  const events = items
    .map(item => {
      const startIso  = item.start?.dateTime || item.start?.date;
      const eventDate = startIso?.split('T')[0];
      if (!eventDate || eventDate < todayStr) return null;
      return {
        id:       item.id,
        title:    item.summary || '(No title)',
        start:    formatTime(item.start?.dateTime) ?? '00:00',
        end:      formatTime(item.end?.dateTime)   ?? '23:59',
        startISO: item.start?.dateTime || null,
        endISO:   item.end?.dateTime   || null,
        date:     eventDate,
        type:     classifyGoogleEvent(item),
      };
    })
    .filter(Boolean);

  // 5. Upsert to calendar_snapshot
  const byDate = {};
  for (const item of items) {
    const startIso  = item.start?.dateTime || item.start?.date;
    const eventDate = startIso?.split('T')[0];
    if (!eventDate || eventDate < todayStr) continue;
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

  await Promise.all(
    Object.entries(byDate).map(([dateStr, dateEvents]) =>
      upsertSnapshotDate(supabase, userId, dateStr, dateEvents, 'google'),
    ),
  );

  return { connected: true, synced: true, datesWritten: Object.keys(byDate).length, events };
}

// ── syncICal ───────────────────────────────────────────────────────────────────

/**
 * Fetch and parse the user's iCal feed URL (stored in user_preferences.apple_ical_url),
 * write events to calendar_snapshot. Returns the normalized event list for the PWA.
 *
 * @returns {{ connected: boolean, synced: boolean, datesWritten: number,
 *             events: object[], error?: string }}
 */
export async function syncICal(supabase, userId) {
  // 1. Load iCal URL
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('apple_ical_url')
    .eq('user_id', userId)
    .single();

  const rawUrl = prefs?.apple_ical_url?.trim();
  if (!rawUrl) return { connected: false, synced: false, datesWritten: 0, events: [], error: 'no_url' };

  const feedUrl = rawUrl.replace(/^webcal:\/\//i, 'https://');

  // 2. Fetch the .ics feed
  let icsText;
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'LifeOrganizer/1.0 iCal-Sync' },
    });
    if (!res.ok) {
      console.error('[calendarSync/ical] Feed fetch failed:', res.status, feedUrl);
      return { connected: true, synced: false, datesWritten: 0, events: [], error: 'feed_fetch_failed' };
    }
    icsText = await res.text();
  } catch (err) {
    console.error('[calendarSync/ical] Feed fetch error:', err.message);
    return { connected: true, synced: false, datesWritten: 0, events: [], error: 'feed_fetch_error' };
  }

  // 3. Parse + normalize
  const now          = new Date();
  const windowEnd    = new Date(now); windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS);
  const todayStr     = now.toISOString().split('T')[0];
  const windowEndStr = windowEnd.toISOString().split('T')[0];

  let icalEvents;
  try {
    icalEvents = await ical.async.parseICS(icsText);
  } catch (err) {
    console.error('[calendarSync/ical] Parse error:', err.message);
    return { connected: true, synced: false, datesWritten: 0, events: [], error: 'parse_failed' };
  }

  const events = normalizeICalEvents(icalEvents, todayStr, windowEndStr);

  // 4. Upsert to calendar_snapshot
  const byDate = {};
  for (const ev of events) {
    const dateStr = ev.date;
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push({
      id:        ev.id,
      title:     ev.title,
      start:     ev.startISO ?? ev.start,
      end:       ev.endISO   ?? ev.end,
      startISO:  ev.startISO,
      endISO:    ev.endISO,
      location:  null,
      attendees: [],
      status:    'confirmed',
      source:    'apple',
    });
  }

  await Promise.all(
    Object.entries(byDate).map(([dateStr, appleEvents]) =>
      upsertSnapshotDate(supabase, userId, dateStr, appleEvents, 'apple'),
    ),
  );

  return { connected: true, synced: true, datesWritten: Object.keys(byDate).length, events };
}
