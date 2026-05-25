// Recommendations feedback endpoint — thumbs-up/down write-back from the PWA.
//
// PATCH /.netlify/functions/recommendations
//   Body: { historyId: number, ref: string, action: "accepted" | "dismissed" | "deferred" }
//   Appends { ref, action, at: ISO } to recommendation_history.item_feedback jsonb array.
//   Does NOT overwrite existing feedback — appends only.
//   Response: { ok: true } or { error: string }
//
// Env vars required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID

import { createClient } from '@supabase/supabase-js';

const VALID_ACTIONS = ['accepted', 'dismissed', 'deferred'];

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

  const method = req.method?.toUpperCase();
  if (method !== 'PATCH') return json({ error: 'method not allowed' }, 405);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const { historyId, ref, action } = body;

  if (!historyId) return json({ error: 'historyId required' }, 400);
  if (!VALID_ACTIONS.includes(action)) {
    return json({ error: `invalid action — must be one of: ${VALID_ACTIONS.join(', ')}` }, 400);
  }

  // Read current item_feedback, append new entry, write back.
  const { data: row, error: fetchErr } = await supabase
    .from('recommendation_history')
    .select('item_feedback')
    .eq('id', historyId)
    .eq('user_id', SUPABASE_USER_ID)
    .single();

  if (fetchErr || !row) return json({ error: 'not found' }, 404);

  const newFeedback = [
    ...(row.item_feedback ?? []),
    { ref: ref ?? null, action, at: new Date().toISOString() },
  ];

  const { error: updateErr } = await supabase
    .from('recommendation_history')
    .update({ item_feedback: newFeedback })
    .eq('id', historyId)
    .eq('user_id', SUPABASE_USER_ID);

  if (updateErr) return json({ error: updateErr.message }, 500);
  return json({ ok: true });
};
