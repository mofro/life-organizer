// useWorldState — React hook for the Context Collector
//
// Calls /.netlify/functions/collect-world-state on mount and on demand.
// The function fetches fresh Beads issues from Railway, writes them to Supabase,
// reads open tasks, and returns the assembled world state.
//
// Returns:
//   beadsReady     — array of ready Beads issues (from beads_ready table)
//   openTasks      — array of open tasks (from open_tasks table)
//   derived        — { tasks_overdue, tasks_due_today, tasks_due_this_week }
//   syncedAt       — ISO timestamp of last successful sync (null if never)
//   beadsError     — string if Beads Service was unreachable (null = fresh data)
//   loading        — true while the first fetch is in flight
//   error          — string if the Netlify function itself failed
//   refresh        — call to trigger a manual sync
//
// Dev note: run `netlify dev` (not `npm run dev`) to execute the function locally.
// `npm run dev` proxies /api to the local Express server but not /.netlify/functions.

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from './supabase.js';

const COLLECTOR_URL = '/.netlify/functions/collect-world-state';

const EMPTY_STATE = {
  beadsReady: [],
  openTasks:  [],
  derived: {
    tasks_overdue:       0,
    tasks_due_today:     0,
    tasks_due_this_week: 0,
  },
  syncedAt:   null,
  beadsError: null,
};

// Normalise a raw beads_ready Supabase row into the task shape expected by the UI.
// Mirrors the normalise() function in useBeadsTasks.js.
function normaliseBeadsRow(row) {
  return {
    id:          row.issue_id,
    beadsId:     row.issue_id,
    title:       row.title,
    category:    'task',
    priority:    normalisePriority(row.priority),
    timeRequired: null,
    deadline:    null,
    status:      row.status     || 'open',
    issueType:   row.issue_type || null,
    source:      'beads',
    sourceUrl:   null,
    project:     projectFromId(row.issue_id),
    blockedBy:          row.blocked_by           || [],
    createdAt:          row.created_at,
    parentFeatureId:    row.parent_feature_id    || null,
    parentFeatureTitle: row.parent_feature_title || null,
    parentPriority:     row.parent_priority      ?? null,
  };
}

function normalisePriority(p) {
  if (p === 0 || p === 1) return 'high';
  if (p === 2) return 'medium';
  return 'low';
}

function projectFromId(id) {
  const dash = id?.lastIndexOf('-');
  return dash > 0 ? id.slice(0, dash) : id;
}

export function useWorldState() {
  const [state,   setState]   = useState(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(COLLECTOR_URL);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setState({
        beadsReady: (data.beadsReady ?? []).map(normaliseBeadsRow),
        openTasks:  data.openTasks   ?? [],
        derived:    data.derived     ?? EMPTY_STATE.derived,
        syncedAt:   data.syncedAt    ?? null,
        beadsError: data.beadsError  ?? null,
      });
    } catch (e) {
      setError(e.message);
      // Keep whatever state we had — don't blank out stale data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, loading, error, refresh };
}
