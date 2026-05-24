// Fetches and parses the user's iCal feed (next 14 days), writes to calendar_snapshot,
// and returns a normalized event list to the PWA.
//
// GET /.netlify/functions/ical-sync
// Response: { connected: boolean, events: Event[], synced_at?: string, error?: string }
//   Event: { id, title, start, end, startISO, endISO, date, type }
//   date:  raw YYYY-MM-DD (UTC) — PWA re-buckets to 'today'/'tomorrow' by local date
//   type:  'meeting' | 'focus' | 'event'
//
// Env vars required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID

import { createClient } from '@supabase/supabase-js';
import { syncICal }     from '../lib/calendarSyncLogic.js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID } = process.env;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const result = await syncICal(supabase, SUPABASE_USER_ID);

  if (!result.connected) return json({ connected: false, events: [] });
  if (result.error)      return json({ connected: true, error: result.error, events: [] });

  return json({ connected: true, events: result.events, synced_at: new Date().toISOString() });
};
