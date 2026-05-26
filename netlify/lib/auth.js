// Shared auth utility for Netlify functions.
// extractUserId(req) — reads the Authorization: Bearer <jwt> header,
// verifies the token against Supabase Auth, and returns the user's UUID.
// Throws an error with { status: 401 } on missing, expired, or invalid tokens.

import { createClient } from '@supabase/supabase-js';

export async function extractUserId(req) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!token) {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }

  return user.id;
}
