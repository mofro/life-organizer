// auth-google-start — initiates Google OAuth with CSRF state protection.
//
// GET /.netlify/functions/auth-google-start
//   Response: { url: string } — the Google OAuth URL to redirect the user to
//   Sets: Set-Cookie: oauth_state=<token>; HttpOnly; [Secure;] SameSite=Lax; Max-Age=600
//
// The browser stores the cookie; auth-google-callback verifies it on return.
// SameSite=Lax allows the cookie to be sent on the top-level GET redirect from Google.
//
// Env vars required:
//   GOOGLE_CLIENT_ID

import { randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const {
  GOOGLE_CLIENT_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

function unauth(msg = 'Unauthorized') {
  return new Response(JSON.stringify({ error: msg }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (req) => {
  if (!GOOGLE_CLIENT_ID) {
    return new Response(JSON.stringify({ error: 'Google OAuth not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the caller's JWT and capture the raw token so it can be embedded
  // in the OAuth state parameter — the callback uses it to identify the user.
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return unauth();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return unauth();

  const origin     = new URL(req.url).origin;
  const csrfToken  = randomBytes(32).toString('hex');
  // state = "<csrfToken>:<userJwt>" — callback splits on first colon
  const state      = `${csrfToken}:${token}`;

  const redirectUri = `${origin}/.netlify/functions/auth-google-callback`;
  const scope = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/gmail.readonly',
  ].join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id',     GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri',  redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope',         scope);
  authUrl.searchParams.set('access_type',   'offline');
  authUrl.searchParams.set('prompt',        'consent');
  authUrl.searchParams.set('state',         state);

  // Cookie stores only the CSRF portion for verification.
  // Secure flag omitted on localhost (Netlify dev over HTTP).
  const isLocalhost = origin.startsWith('http://localhost');
  const cookie = [
    `oauth_state=${csrfToken}`,
    'HttpOnly',
    isLocalhost ? null : 'Secure',
    'SameSite=Lax',
    'Max-Age=600',
    'Path=/',
  ].filter(Boolean).join('; ');

  return new Response(JSON.stringify({ url: authUrl.toString() }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
  });
};
