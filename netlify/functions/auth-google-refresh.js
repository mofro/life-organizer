// Returns a fresh Google access token by exchanging the stored refresh token.
// Called by Calendar adapter and Gmail cron before each API call.
//
// Auth: Bearer token must match BEADS_API_KEY (server-to-server only).
// The refresh token is never sent to the caller — only the short-lived access token.
//
// POST /.netlify/functions/auth-google-refresh
// Authorization: Bearer <BEADS_API_KEY>
//
// Response: { access_token: string, expires_in: number }
//
// Env vars required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID
//   BEADS_API_KEY (shared secret for server-to-server auth)

import { createClient } from '@supabase/supabase-js';

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_USER_ID,
  BEADS_API_KEY,
} = process.env;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${BEADS_API_KEY}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error: dbError } = await supabase
    .from('user_preferences')
    .select('google_refresh_token')
    .eq('user_id', SUPABASE_USER_ID)
    .single();

  if (dbError || !data?.google_refresh_token) {
    return json({ error: 'Google not connected — authorize via the app settings first' }, 400);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: data.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('[auth-google-refresh] Token refresh failed:', body);
    return json({ error: 'Token refresh failed' }, 502);
  }

  const { access_token, expires_in } = await tokenRes.json();
  return json({ access_token, expires_in });
};
