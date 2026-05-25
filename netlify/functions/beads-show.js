// beads-show — proxy for GET /api/beads/show/:id on the Railway Beads Service.
//
// Called by BeadsTaskRow when a user expands an issue to see its description,
// notes, design, and acceptance criteria. The BEADS_API_KEY is kept server-side
// here and never exposed to the browser.
//
// Usage: GET /.netlify/functions/beads-show?id=life-xqz
//
// Returns: the raw issue object from Railway (title, description, notes, etc.)
// Errors:  { error: "..." } with appropriate HTTP status

const BEADS_SERVICE_URL = process.env.BEADS_SERVICE_URL;
const BEADS_API_KEY     = process.env.BEADS_API_KEY;

export default async (req) => {
  const url = new URL(req.url);
  const id  = url.searchParams.get('id');

  if (!id) {
    return new Response(JSON.stringify({ error: 'id query parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!BEADS_SERVICE_URL) {
    return new Response(JSON.stringify({ error: 'BEADS_SERVICE_URL not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const headers = {};
    if (BEADS_API_KEY) headers['Authorization'] = `Bearer ${BEADS_API_KEY}`;

    const res = await fetch(
      `${BEADS_SERVICE_URL}/api/beads/show/${encodeURIComponent(id)}`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`[beads-show] Railway error ${res.status}:`, body);
      return new Response(JSON.stringify({ error: 'upstream error' }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[beads-show] Railway call failed:', e.message);
    return new Response(JSON.stringify({ error: 'upstream error' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
