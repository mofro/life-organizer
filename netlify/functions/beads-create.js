// beads-create — proxy for POST /api/beads/create on the Railway Beads Service.
//
// Called by ConversationIntakeResult when auto-creating or approving a beads item.
// The BEADS_API_KEY is kept server-side and never exposed to the browser.
//
// POST /.netlify/functions/beads-create
//   Body: { title: string, description?: string, type?: string, priority?: number, labels?: string[] }
//   Returns: the created issue object from Railway (id, title, ...)
//
// Env vars required:
//   BEADS_SERVICE_URL, BEADS_API_KEY

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
  if (!BEADS_SERVICE_URL) return json({ error: 'BEADS_SERVICE_URL not configured' }, 503);

  let body = {};
  try { body = await req.json(); } catch { /* empty body */ }

  if (!body.title?.trim()) return json({ error: 'title is required' }, 400);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (BEADS_API_KEY) headers['Authorization'] = `Bearer ${BEADS_API_KEY}`;

    const res = await fetch(`${BEADS_SERVICE_URL}/api/beads/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`[beads-create] Railway error ${res.status}:`, data);
      return json({ error: 'upstream error' }, res.status);
    }

    return json(data, 201);
  } catch (e) {
    console.error('[beads-create] Railway call failed:', e.message);
    return json({ error: 'upstream error' }, 503);
  }
};
