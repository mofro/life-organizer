// beads-show — returns full issue detail from DoltHub for the expand panel.
//
// Called by BeadsTaskRow when a user expands an issue to see its description,
// notes, design, and acceptance criteria.
//
// Uses the DoltHub REST API directly (same as beads-issue.mjs) — no Railway
// dependency for reads. The DoltHub repo is public so no auth is needed there.
//
// Usage: GET /.netlify/functions/beads-show?id=life-xqz
// Returns: { id, title, description, notes, design, acceptance, external_ref, ... }

import { extractUserId } from '../lib/auth.js';

const DOLTHUB_API = 'https://www.dolthub.com/api/v1alpha1/mofro/beads-global/main';

async function doltQuery(sql) {
  const res = await fetch(`${DOLTHUB_API}?q=${encodeURIComponent(sql)}`);
  if (!res.ok) throw new Error(`DoltHub error: ${res.status}`);
  const body = await res.json();
  if (body.query_execution_status !== 'Success') {
    throw new Error(`DoltHub query failed: ${body.query_execution_message}`);
  }
  return body.rows;
}

export default async (req) => {
  try { await extractUserId(req); }
  catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const id  = url.searchParams.get('id') ?? '';

  if (!id) {
    return new Response(JSON.stringify({ error: 'id query parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Allowlist: only alphanumeric and hyphens — safe for SQL interpolation
  if (!/^[a-zA-Z0-9-]+$/.test(id)) {
    return new Response(JSON.stringify({ error: 'Invalid issue id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const [issueRows, depRows] = await Promise.all([
      doltQuery(`
        SELECT id, title, description, notes, design, acceptance_criteria,
               external_ref, status, priority, issue_type, owner, updated_at
        FROM issues
        WHERE id = '${id}'
        LIMIT 1
      `),
      doltQuery(`
        SELECT issue_id, depends_on_id
        FROM dependencies
        WHERE issue_id = '${id}'
      `),
    ]);

    if (!issueRows.length) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const row = issueRows[0];
    const issue = {
      ...row,
      priority:    Number(row.priority),
      acceptance:  row.acceptance_criteria || null,  // UI uses `acceptance`
      dependencies: depRows.map(d => ({ depends_on_id: d.depends_on_id })),
    };
    delete issue.acceptance_criteria;

    return new Response(JSON.stringify(issue), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[beads-show] DoltHub call failed:', e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
