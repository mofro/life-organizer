// Notifications endpoint — write-back for rules engine fired alerts.
//
// PATCH /.netlify/functions/notifications?id=<logId>
//   Body: { action: "dismissed" | "accepted" | "ignored" }
//   Writes user_action and action_at to the matching notification_log row.
//   Response: { ok: true } or { error: string }
//
// GET /.netlify/functions/notifications?since=<ISO>&channel=<ch>
//   Returns notification_log rows with user_action IS NULL (undismissed),
//   optionally filtered by channel and fired_at >= since.
//   Used by useRulesEngine.js to reload undismissed alerts on app open.
//   Response: { notifications: [...] }
//
// Env vars required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID

import { createClient } from '@supabase/supabase-js';

const VALID_ACTIONS = ['dismissed', 'accepted', 'ignored'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (req) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_USER_ID) {
    return json({ error: 'Missing server configuration' }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const url      = new URL(req.url);
  const method   = req.method?.toUpperCase();

  // ── PATCH: record user action on a notification ───────────────────────────
  if (method === 'PATCH') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id required' }, 400);

    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const { action } = body;
    if (!VALID_ACTIONS.includes(action)) {
      return json({ error: `invalid action — must be one of: ${VALID_ACTIONS.join(', ')}` }, 400);
    }

    const { data, error } = await supabase
      .from('notification_log')
      .update({ user_action: action, action_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', SUPABASE_USER_ID)
      .select('id')
      .single();

    if (error || !data) return json({ error: 'not found' }, 404);
    return json({ ok: true });
  }

  // ── GET: load undismissed notifications ───────────────────────────────────
  if (method === 'GET') {
    const since   = url.searchParams.get('since');
    const channel = url.searchParams.get('channel');

    let query = supabase
      .from('notification_log')
      .select('id,rule_id,channel,title,body,payload,fired_at')
      .eq('user_id', SUPABASE_USER_ID)
      .is('user_action', null)
      .order('fired_at', { ascending: false })
      .limit(50);

    if (since)   query = query.gte('fired_at', since);
    if (channel) query = query.eq('channel', channel);

    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);
    return json({ notifications: data ?? [] });
  }

  return json({ error: 'method not allowed' }, 405);
};
