// Returns whether the user has connected Google (i.e. a refresh token is stored).
// Called by the PWA settings panel on mount to show the Connect/Connected button state.
//
// GET /.netlify/functions/auth-google-status
// Response: { connected: boolean }
//
// Env vars required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID

import { createClient } from '@supabase/supabase-js';

const {
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
  const { data, error } = await supabase
    .from('user_preferences')
    .select('google_refresh_token')
    .eq('user_id', SUPABASE_USER_ID)
    .single();

  if (error) {
    console.error('[auth-google-status] DB read failed:', error.message);
    return json({ connected: false }, 500);
  }

  return json({ connected: !!data?.google_refresh_token });
};
