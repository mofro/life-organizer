// Fetches and parses an iCal (.ics) feed URL stored in user_preferences.apple_ical_url,
// writes events to calendar_snapshot (merging with existing non-Apple events), and
// returns a normalized event list matching the shape used by calendar-sync.js.
//
// GET /.netlify/functions/ical-sync
// Response: { connected: boolean, events: Event[], synced_at?: string, error?: string }
//   Event: { id, title, start, end, date, type }
//   date:  'today' | 'tomorrow'
//   type:  'meeting' | 'focus' | 'event'
//
// Env vars required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID

import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID } = process.env;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Inline iCal parser ────────────────────────────────────────────────────────

/**
 * Unfold RFC 5545 line continuations and split into logical lines.
 * A folded line ends with CRLF (or LF) followed by a whitespace char on the next line.
 */
function unfoldLines(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');
}

/**
 * Parse an iCal text into an array of raw VEVENT objects.
 * Each object is a map of property name → { value, params }.
 * Multi-value properties (e.g. ATTENDEE) are stored as arrays.
 */
function parseICS(text) {
  const lines  = unfoldLines(text).split('\n');
  const events = [];
  let inEvent  = false;
  let current  = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'BEGIN:VEVENT') { inEvent = true; current = {}; continue; }
    if (trimmed === 'END:VEVENT')   { inEvent = false; if (current.UID) events.push(current); continue; }
    if (!inEvent) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;

    const keyPart = trimmed.slice(0, colonIdx);
    const rawVal  = trimmed.slice(colonIdx + 1);

    // Split key from params: DTSTART;TZID=America/New_York → base=DTSTART, params={TZID:...}
    const [baseName, ...paramParts] = keyPart.split(';');
    const base   = baseName.toUpperCase();
    const params = Object.fromEntries(
      paramParts.map(p => {
        const eq = p.indexOf('=');
        return eq >= 0 ? [p.slice(0, eq).toUpperCase(), p.slice(eq + 1)] : [p.toUpperCase(), ''];
      }),
    );

    // Unescape common iCal text sequences
    const val = rawVal.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\\\/g, '\\');

    switch (base) {
      case 'UID':
      case 'SUMMARY':
      case 'STATUS':
      case 'DTSTART':
      case 'DTEND':
        current[base] = { value: val, params };
        break;
      case 'ATTENDEE':
        current.ATTENDEE = current.ATTENDEE ?? [];
        current.ATTENDEE.push(val);
        break;
    }
  }

  return events;
}

/**
 * Parse an iCal date/datetime value into an ISO 8601 string.
 * Returns { iso: string, allDay: boolean } or null if unparseable.
 *
 * Handles:
 *   VALUE=DATE   → YYYYMMDD (all-day)
 *   UTC          → YYYYMMDDTHHmmssZ
 *   Floating     → YYYYMMDDTHHmmss (treated as UTC for date-bucketing)
 *   TZID         → YYYYMMDDTHHmmss (timezone stripped; used only for date/time extraction)
 */
function parseDateVal(value, params) {
  if (!value) return null;

  if (params?.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    // All-day date: YYYYMMDD
    const y = value.slice(0, 4), m = value.slice(4, 6), d = value.slice(6, 8);
    return { iso: `${y}-${m}-${d}T00:00:00Z`, allDay: true };
  }

  // Datetime: YYYYMMDDTHHmmss[Z]
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) return null;

  const [, y, mo, d, h, min, s, z] = match;
  return {
    iso:    `${y}-${mo}-${d}T${h}:${min}:${s}${z || 'Z'}`,
    allDay: false,
  };
}

/** HH:MM from an ISO string, or the fallback. */
function timeOf(iso, fallback) {
  const m = iso?.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : fallback;
}

/**
 * Classify an event: meeting (has attendees), event (all-day), focus (personal timed block).
 */
function classifyEvent(raw, allDay) {
  if (allDay) return 'event';
  return (raw.ATTENDEE?.length ?? 0) > 0 ? 'meeting' : 'focus';
}

/**
 * Normalize raw VEVENT objects into the PWA event shape.
 * Only includes events on todayStr or tomorrowStr (YYYY-MM-DD).
 */
function normalizeEvents(rawEvents, todayStr, tomorrowStr) {
  const results = [];

  for (const ev of rawEvents) {
    if (ev.STATUS?.value === 'CANCELLED') continue;

    const startParsed = parseDateVal(ev.DTSTART?.value, ev.DTSTART?.params);
    const endParsed   = parseDateVal(ev.DTEND?.value,   ev.DTEND?.params);
    if (!startParsed) continue;

    const eventDate = startParsed.iso.split('T')[0];
    const date =
      eventDate === todayStr    ? 'today'
      : eventDate === tomorrowStr ? 'tomorrow'
      : null;
    if (!date) continue;

    results.push({
      id:    ev.UID?.value ?? `ical-${eventDate}-${Math.random()}`,
      title: ev.SUMMARY?.value || '(No title)',
      start: timeOf(startParsed.iso, '00:00'),
      end:   timeOf(endParsed?.iso, '23:59'),
      date,
      type:  classifyEvent(ev, startParsed.allDay),
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
  const now       = new Date();
  const tomorrow  = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const todayStr    = now.toISOString().split('T')[0];
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const rawEvents = parseICS(icsText);
  const events    = normalizeEvents(rawEvents, todayStr, tomorrowStr);

  // ── 4. Upsert to calendar_snapshot (merge with non-Apple events) ─────────────
  const byDate = {};
  for (const ev of events) {
    const dateStr = ev.date === 'today' ? todayStr : tomorrowStr;
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push({
      id:        ev.id,
      title:     ev.title,
      start:     ev.start,
      end:       ev.end,
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
