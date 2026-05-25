// Nightly scheduled calendar sync — runs both Google and Apple iCal syncs
// for every user who has a connected calendar.
//
// Triggered automatically at 06:00 UTC daily via netlify.toml [[schedule]].
// Also callable on-demand (GET) for manual triggering / debugging.
//
// Response: { usersProcessed, results: [{user_id, google, ical}], synced_at }
//
// Env vars required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { syncGoogle, syncICal } from '../lib/calendarSyncLogic.js';

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch all user_preferences rows (service role, no RLS). Filter in memory
  // to users who have at least one connected calendar source.
  const { data: allPrefs, error: prefsErr } = await supabase
    .from('user_preferences')
    .select('user_id, google_refresh_token, ical_feeds');

  if (prefsErr) {
    console.error('[calendar-sync-scheduled] Failed to load user preferences:', prefsErr.message);
    return json({ error: 'failed_to_load_users' }, 500);
  }

  const activeUsers = (allPrefs ?? []).filter(u =>
    u.google_refresh_token ||
    (Array.isArray(u.ical_feeds) && u.ical_feeds.length > 0),
  );

  if (activeUsers.length === 0) {
    console.log('[calendar-sync-scheduled] No users with connected calendars — nothing to sync.');
    return json({ usersProcessed: 0, results: [], synced_at: new Date().toISOString() });
  }

  const results = [];

  for (const { user_id } of activeUsers) {
    const [googleResult, icalResult] = await Promise.all([
      syncGoogle(supabase, user_id, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
        .catch(err => {
          console.error(`[calendar-sync-scheduled] Google sync threw for ${user_id}:`, err.message);
          return { connected: false, synced: false, datesWritten: 0, error: err.message };
        }),
      syncICal(supabase, user_id)
        .catch(err => {
          console.error(`[calendar-sync-scheduled] iCal sync threw for ${user_id}:`, err.message);
          return { connected: false, synced: false, datesWritten: 0, error: err.message };
        }),
    ]);

    console.log(`[calendar-sync-scheduled] ${user_id}:`,
      `Google: ${googleResult.synced ? `${googleResult.datesWritten} dates` : googleResult.error ?? 'not connected'}.`,
      `iCal: ${icalResult.synced ? `${icalResult.datesWritten} dates` : icalResult.error ?? 'not connected'}.`,
    );

    results.push({
      user_id,
      google: { connected: googleResult.connected, synced: googleResult.synced, datesWritten: googleResult.datesWritten, error: googleResult.error ?? null },
      ical:   { connected: icalResult.connected,   synced: icalResult.synced,   datesWritten: icalResult.datesWritten,   error: icalResult.error   ?? null },
    });
  }

  return json({ usersProcessed: activeUsers.length, results, synced_at: new Date().toISOString() });
};

// Netlify scheduled function — runs at 06:00 UTC daily.
export const config = { schedule: '0 6 * * *' };
