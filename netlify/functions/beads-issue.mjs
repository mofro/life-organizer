// beads-issue — Netlify Function
// Returns a single issue by ?id=<issue-id> from DoltHub mofro/beads-global.
// Requires: Authorization: Bearer <supabase-access-token>

import { extractUserId } from '../lib/auth.js';

const DOLTHUB_API = 'https://www.dolthub.com/api/v1alpha1/mofro/beads-global/main';

async function doltQuery(sql) {
  const url = `${DOLTHUB_API}?q=${encodeURIComponent(sql)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DoltHub error: ${res.status}`);
  const body = await res.json();
  if (body.query_execution_status !== 'Success') {
    throw new Error(`DoltHub query failed: ${body.query_execution_message}`);
  }
  return body.rows;
}

export default async function handler(req) {
  try {
    await extractUserId(req);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';

  // Allowlist characters to prevent SQL injection
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return new Response(JSON.stringify({ error: 'Invalid issue id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const [issueRows, depRows] = await Promise.all([
      doltQuery(`SELECT * FROM issues WHERE id = '${id}' LIMIT 1`),
      doltQuery(`SELECT issue_id, depends_on_id FROM dependencies WHERE issue_id = '${id}'`),
    ]);

    if (!issueRows.length) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const issue = {
      ...issueRows[0],
      priority: Number(issueRows[0].priority),
      dependencies: depRows.map(d => ({ depends_on_id: d.depends_on_id })),
    };

    return new Response(JSON.stringify(issue), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
