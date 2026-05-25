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
import { extractUserId } from '../lib/auth.js';

const { GOOGLE_CLIENT_ID } = process.env;

export default async (req) => {
  try { await extractUserId(req); }
  catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!GOOGLE_CLIENT_ID) {
    return new Response(JSON.stringify({ error: 'Google OAuth not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const origin = new URL(req.url).origin;
  const state  = randomBytes(32).toString('hex');

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

  // Secure flag omitted on localhost (Netlify dev over HTTP).
  const isLocalhost = origin.startsWith('http://localhost');
  const cookie = [
    `oauth_state=${state}`,
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
