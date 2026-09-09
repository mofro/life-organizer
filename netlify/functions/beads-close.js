// beads-close — proxy for POST /api/beads/close/:id on the Railway Beads Service.
//
// POST /.netlify/functions/beads-close
//   Body: { id: string, reason: string }
//   Returns: { ok: true }
//
// Env vars required:
//   BEADS_SERVICE_URL, BEADS_API_KEY

import { extractUserId } from '../lib/auth.js';

const BEADS_SERVICE_URL = process.env.BEADS_SERVICE_URL;
const BEADS_API_KEY     = process.env.BEADS_API_KEY;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (req) => {
  if (req.method?.toUpperCase() !== 'POST') return json({ error: 'method not allowed' }, 405);

  try { await extractUserId(req); }
  catch { return json({ error: 'Unauthorized' }, 401); }

  if (!BEADS_SERVICE_URL) return json({ error: 'BEADS_SERVICE_URL not configured' }, 503);

  let body = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const id     = body.id?.trim();
  const reason = body.reason?.trim();
  if (!id)     return json({ error: 'id is required' }, 400);
  if (!reason) return json({ error: 'reason is required' }, 400);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (BEADS_API_KEY) headers['Authorization'] = `Bearer ${BEADS_API_KEY}`;

    const res = await fetch(`${BEADS_SERVICE_URL}/api/beads/close/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(20_000),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`[beads-close] Railway error ${res.status}:`, data);
      return json({ error: data.error || 'upstream error' }, res.status);
    }

    return json(data);
  } catch (e) {
    console.error('[beads-close] Railway call failed:', e.message);
    return json({ error: 'upstream error' }, 503);
  }
};
