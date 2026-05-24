// Fetches and parses an iCal (.ics) feed URL stored in user_preferences.apple_ical_url,
// writes events to calendar_snapshot (merging with existing non-Apple events), and
// returns a normalized event list matching the shape used by calendar-sync.js.
//
// GET /.netlify/functions/ical-sync
// Response: { connected: boolean, events: Event[], synced_at?: string, error?: string }
//   Event: { id, title, start, end, startISO, endISO, date, type }
//   date:  raw YYYY-MM-DD (UTC) — PWA re-buckets to 'today'/'tomorrow' by local date
//   type:  'meeting' | 'focus' | 'event'
//
// Env vars required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID

import ical       from 'node-ical';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID } = process.env;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── node-ical helpers ─────────────────────────────────────────────────────────

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

function classifyEvent(ev, allDay) {
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
 * node-ical returns proper JavaScript Date objects — TZID is handled correctly,
 * all dates are UTC internally. All-day events have ev.start.dateOnly = true.
 *
 * Returns all events in [todayStr, windowEndStr] (UTC date range).
 * PWA re-buckets 'today'/'tomorrow' from startISO using browser local date.
 */
function normalizeEvents(icalEvents, todayStr, windowEndStr) {
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
      id:       ev.uid   ?? `ical-${eventDate}-${Math.random()}`,
      title:    getSummary(ev),
      start:    allDay ? '00:00' : timeOf(startISO, '00:00'),
      end:      allDay ? '23:59' : timeOf(endISO,   '23:59'),
      startISO: allDay ? null : startISO,
      endISO:   allDay ? null : endISO,
      date:     eventDate,   // UTC date — PWA re-buckets to 'today'/'tomorrow'
      type:     classifyEvent(ev, allDay),
    });
  }

  return results;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── 1. Load the stored iCal URL ──────────────────────────────────────────────
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('apple_ical_url')
    .eq('user_id', SUPABASE_USER_ID)
    .single();

  const rawUrl = prefs?.apple_ical_url?.trim();
  if (!rawUrl) return json({ connected: false, events: [] });

  // Normalise webcal:// → https:// (Apple Calendar share links use webcal)
  const feedUrl = rawUrl.replace(/^webcal:\/\//i, 'https://');

  // ── 2. Fetch the .ics feed ───────────────────────────────────────────────────
  let icsText;
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'LifeOrganizer/1.0 iCal-Sync' },
    });
    if (!res.ok) {
      console.error('[ical-sync] Feed fetch failed:', res.status, feedUrl);
      return json({ connected: true, error: 'feed_fetch_failed', events: [] });
    }
    icsText = await res.text();
  } catch (err) {
    console.error('[ical-sync] Feed fetch error:', err.message);
    return json({ connected: true, error: 'feed_fetch_error', events: [] });
  }

  // ── 3. Parse + normalize ─────────────────────────────────────────────────────
  const now          = new Date();
  const windowEnd    = new Date(now); windowEnd.setDate(windowEnd.getDate() + 14);
  const todayStr     = now.toISOString().split('T')[0];
  const windowEndStr = windowEnd.toISOString().split('T')[0];

  let icalEvents;
  try {
    icalEvents = await ical.async.parseICS(icsText);
  } catch (err) {
    console.error('[ical-sync] Parse error:', err.message);
    return json({ connected: true, error: 'parse_failed', events: [] });
  }

  const events = normalizeEvents(icalEvents, todayStr, windowEndStr);

  // ── 4. Upsert to calendar_snapshot (merge with non-Apple events) ─────────────
  const byDate = {};
  for (const ev of events) {
    const dateStr = ev.date;
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push({
      id:        ev.id,
      title:     ev.title,
      start:     ev.startISO ?? ev.start,  // full ISO string; HH:MM fallback for all-day
      end:       ev.endISO   ?? ev.end,
      startISO:  ev.startISO,
      endISO:    ev.endISO,
      location:  null,
      attendees: [],
      status:    'confirmed',
      source:    'apple',
    });
  }

  for (const [dateStr, appleEvents] of Object.entries(byDate)) {
    const { data: snap } = await supabase
      .from('calendar_snapshot')
      .select('events')
      .eq('user_id', SUPABASE_USER_ID)
      .eq('event_date', dateStr)
      .single();

    const preserved = (snap?.events ?? []).filter(e => e.source !== 'apple');
    const merged    = [...preserved, ...appleEvents];

    const { error: upsertErr } = await supabase
      .from('calendar_snapshot')
      .upsert(
        { user_id: SUPABASE_USER_ID, event_date: dateStr, events: merged },
        { onConflict: 'user_id,event_date' },
      );
    if (upsertErr) {
      console.error('[ical-sync] Snapshot upsert failed for', dateStr, upsertErr.message);
    }
  }

  return json({ connected: true, events, synced_at: new Date().toISOString() });
};
