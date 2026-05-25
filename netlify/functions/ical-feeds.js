// ical-feeds — manage the user's iCal feed URL list (user_preferences.ical_feeds).
//
// GET  /.netlify/functions/ical-feeds
//   Response: { feeds: string[] }
//
// POST /.netlify/functions/ical-feeds
//   Body: { url: string }   — adds a feed (normalises webcal:// → https://)
//   Response: { feeds: string[] }
//
// DELETE /.netlify/functions/ical-feeds
//   Body: { url: string }   — removes a feed by exact URL
//   Response: { feeds: string[] }
//
// Env vars required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID

import { createClient } from '@supabase/supabase-js';
import { extractUserId } from '../lib/auth.js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadFeeds(supabase, userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('ical_feeds')
    .eq('user_id', userId)
    .single();
  if (error || !data) return [];
  return Array.isArray(data.ical_feeds) ? data.ical_feeds : [];
}

async function saveFeeds(supabase, userId, feeds) {
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, ical_feeds: feeds }, { onConflict: 'user_id' });
  return error;
}

export default async (req) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Missing server configuration' }, 500);
  }

  const method = req.method?.toUpperCase();
  if (!['GET', 'POST', 'DELETE'].includes(method)) {
    return json({ error: 'method not allowed' }, 405);
  }

  let userId;
  try { userId = await extractUserId(req); }
  catch { return json({ error: 'Unauthorized' }, 401); }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (method === 'GET') {
    return json({ feeds: await loadFeeds(supabase, userId) });
  }

  let body = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const raw = (body?.url ?? '').trim();
  if (!raw) return json({ error: 'url is required' }, 400);

  const normalized = raw.replace(/^webcal:\/\//i, 'https://');
  if (!/^https?:\/\/.+/i.test(normalized)) {
    return json({ error: 'URL must start with https:// or webcal://' }, 400);
  }

  // SSRF protection: reject private/internal hostnames at storage time.
  let hostname;
  try { hostname = new URL(normalized).hostname.toLowerCase(); }
  catch { return json({ error: 'invalid URL' }, 400); }

  const SSRF_DENY = [
    /^localhost$/,
    /\.local$/,
    /\.internal$/,
    /^\[/,                              // IPv6 literals e.g. [::1]
    /^\d+\.\d+\.\d+\.\d+$/,            // any numeric IPv4
  ];
  if (SSRF_DENY.some(re => re.test(hostname))) {
    return json({ error: 'URL hostname is not allowed' }, 400);
  }

  const feeds = await loadFeeds(supabase, userId);

  if (method === 'POST') {
    if (feeds.includes(normalized)) return json({ feeds }); // already present
    const updated = [...feeds, normalized];
    const err = await saveFeeds(supabase, userId, updated);
    if (err) return json({ error: err.message }, 500);
    return json({ feeds: updated });
  }

  if (method === 'DELETE') {
    const updated = feeds.filter(u => u !== normalized);
    const err = await saveFeeds(supabase, userId, updated);
    if (err) return json({ error: err.message }, 500);
    return json({ feeds: updated });
  }
};
