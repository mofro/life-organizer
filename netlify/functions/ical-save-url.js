// Saves or clears the user's iCal feed URL in user_preferences.apple_ical_url.
// Normalises webcal:// to https:// before storing.
//
// POST /.netlify/functions/ical-save-url
// Body: { url: string }  — empty string clears the URL
// Response: { ok: boolean, url?: string, error?: string }
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

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const raw = (body?.url ?? '').trim();

  // Validate: must be empty (clear) or a recognisable calendar feed URL
  let normalized = raw;
  if (raw) {
    normalized = raw.replace(/^webcal:\/\//i, 'https://');
    if (!/^https?:\/\/.+/i.test(normalized)) {
      return json({ error: 'URL must start with https:// or webcal://' }, 400);
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { user_id: SUPABASE_USER_ID, apple_ical_url: normalized || null },
      { onConflict: 'user_id' },
    );

  if (error) {
    console.error('[ical-save-url] DB write failed:', error.message);
    return json({ error: 'db_write_failed' }, 500);
  }

  return json({ ok: true, url: normalized || null });
};
