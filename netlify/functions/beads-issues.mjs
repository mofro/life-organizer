// beads-issues — Netlify Function
// Returns all issues from DoltHub mofro/beads-global with embedded dependencies[].
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

  try {
    const [issueRows, depRows] = await Promise.all([
      doltQuery(`
        SELECT id, title, status, priority, issue_type, description, notes,
               updated_at, created_at, owner, external_ref, assignee, source_repo
        FROM issues
        ORDER BY updated_at DESC
        LIMIT 1000
      `),
      doltQuery(`
        SELECT issue_id, depends_on_id
        FROM dependencies
        LIMIT 2000
      `),
    ]);

    // Build dependency map: issue_id → [{depends_on_id}]
    const depMap = {};
    for (const d of depRows) {
      if (!depMap[d.issue_id]) depMap[d.issue_id] = [];
      depMap[d.issue_id].push({ depends_on_id: d.depends_on_id });
    }

    const issues = issueRows.map(i => ({
      ...i,
      priority: Number(i.priority),
      dependencies: depMap[i.id] || [],
    }));

    return new Response(JSON.stringify(issues), {
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
