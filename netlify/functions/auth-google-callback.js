// Exchanges a Google OAuth auth code for access + refresh tokens and stores
// the refresh token in Supabase user_preferences.google_refresh_token.
//
// Google redirects here after the user grants consent on the OAuth screen.
// Redirect URI registered in Google Cloud Console must match this function's URL exactly:
//   Dev:  http://localhost:8888/.netlify/functions/auth-google-callback
//   Prod: https://<your-netlify-app>.netlify.app/.netlify/functions/auth-google-callback
//
// State parameter format: "<csrfToken>:<userJwt>"
//   csrfToken — verified against oauth_state cookie (CSRF protection)
//   userJwt   — Supabase access token encoded by auth-google-start; identifies which user
//               to store the refresh token for (replaces hardcoded SUPABASE_USER_ID)
//
// Env vars required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

function parseCookies(header) {
  const cookies = {};
  for (const part of (header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name  = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

export default async (req) => {
  const url = new URL(req.url);
  const stateParam = url.searchParams.get('state');
  const code       = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');
  const origin     = url.origin;

  if (oauthError) {
    console.error('[auth-google-callback] OAuth error:', oauthError);
    return Response.redirect(`${origin}/settings?google=error&reason=${encodeURIComponent(oauthError)}`);
  }

  // CSRF verification — state format: "<csrfToken>:<userJwt>"
  // Cookie stores only the CSRF token; JWT travels only in the state param.
  const cookies     = parseCookies(req.headers.get('cookie'));
  const cookieState = cookies.oauth_state;
  const colonIdx    = (stateParam ?? '').indexOf(':');
  const csrfPart    = colonIdx > 0 ? stateParam.slice(0, colonIdx) : null;
  const jwtPart     = colonIdx > 0 ? stateParam.slice(colonIdx + 1) : null;

  if (!csrfPart || !cookieState || csrfPart !== cookieState) {
    console.error('[auth-google-callback] CSRF state mismatch');
    return Response.redirect(`${origin}/settings?google=error&reason=csrf_mismatch`);
  }

  // Authenticate the user from the JWT embedded in state.
  if (!jwtPart) {
    return Response.redirect(`${origin}/settings?google=error&reason=missing_user_token`);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwtPart);
  if (authErr || !user) {
    console.error('[auth-google-callback] JWT from state is invalid or expired');
    return Response.redirect(`${origin}/settings?google=error&reason=user_auth_failed`);
  }
  const userId = user.id;

  if (!code) {
    return Response.redirect(`${origin}/settings?google=error&reason=missing_code`);
  }

  const redirectUri = `${origin}/.netlify/functions/auth-google-callback`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('[auth-google-callback] Token exchange failed:', body);
    return Response.redirect(`${origin}/settings?google=error&reason=token_exchange_failed`);
  }

  const tokens = await tokenRes.json();

  if (!tokens.refresh_token) {
    // Google only returns refresh_token on first consent or when prompt=consent forces it.
    // If missing, the user needs to re-authorize with prompt=consent.
    console.error('[auth-google-callback] No refresh_token in response');
    return Response.redirect(`${origin}/settings?google=error&reason=no_refresh_token`);
  }

  const { error: dbError } = await supabase
    .from('user_preferences')
    .upsert(
      { user_id: userId, google_refresh_token: tokens.refresh_token },
      { onConflict: 'user_id' },
    );

  if (dbError) {
    console.error('[auth-google-callback] DB update failed:', dbError.message);
    return Response.redirect(`${origin}/settings?google=error&reason=db_write_failed`);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/settings?google=connected`,
      'Set-Cookie': 'oauth_state=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/',
    },
  });
};
