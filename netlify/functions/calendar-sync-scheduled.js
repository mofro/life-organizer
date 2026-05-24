// Nightly scheduled calendar sync — runs both Google and Apple iCal syncs.
// Triggered automatically at 06:00 UTC daily via netlify.toml [[schedule]].
//
// Also callable on-demand (GET) for manual triggering / debugging.
// Response: { googleResult, icalResult, synced_at }
//   Each result: { connected, synced, datesWritten, error? }
//
// Env vars required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID

import { createClient } from '@supabase/supabase-js';
import { syncGoogle, syncICal } from '../lib/calendarSyncLogic.js';

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

export default async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Run both syncs in parallel — a failure in one does not block the other.
  const [googleResult, icalResult] = await Promise.all([
    syncGoogle(supabase, SUPABASE_USER_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
      .catch(err => {
        console.error('[calendar-sync-scheduled] Google sync threw:', err.message);
        return { connected: false, synced: false, datesWritten: 0, events: [], error: err.message };
      }),
    syncICal(supabase, SUPABASE_USER_ID)
      .catch(err => {
        console.error('[calendar-sync-scheduled] iCal sync threw:', err.message);
        return { connected: false, synced: false, datesWritten: 0, events: [], error: err.message };
      }),
  ]);

  console.log('[calendar-sync-scheduled] Done.',
    `Google: ${googleResult.synced ? `${googleResult.datesWritten} dates` : googleResult.error ?? 'not connected'}.`,
    `iCal: ${icalResult.synced ? `${icalResult.datesWritten} dates` : icalResult.error ?? 'not connected'}.`,
  );

  return json({
    googleResult: { connected: googleResult.connected, synced: googleResult.synced, datesWritten: googleResult.datesWritten, error: googleResult.error },
    icalResult:   { connected: icalResult.connected,   synced: icalResult.synced,   datesWritten: icalResult.datesWritten,   error: icalResult.error },
    synced_at: new Date().toISOString(),
  });
};

// Netlify scheduled function — runs at 06:00 UTC daily.
export const config = { schedule: '0 6 * * *' };
