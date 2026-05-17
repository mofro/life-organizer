import { useState, useEffect, useCallback } from 'react';

export function useBeadsTasks() {
  const [tasks, setTasks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.fetch('/api/beads/ready');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      setTasks(raw.map(normalise));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const claim = useCallback(async (id) => {
    const res = await window.fetch(`/api/beads/claim/${id}`, { method: 'POST' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Claim failed');
    await refresh();
  }, [refresh]);

  const close = useCallback(async (id, reason) => {
    const res = await window.fetch(`/api/beads/close/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Close failed');
    await refresh();
  }, [refresh]);

  return { tasks, loading, error, refresh, claim, close };
}

function normalise(issue) {
  return {
    id:           issue.id,
    title:        issue.title,
    category:     issue.type || 'task',
    priority:     normalisePriority(issue.priority),
    timeRequired: null,
    deadline:     issue.deadline || null,
    status:       normaliseStatus(issue.status),
    source:       'beads',
    sourceUrl:    null,
    beadsId:      issue.id,
    project:      projectFromId(issue.id),
    blockedBy:    issue.blocked_by || [],
    createdAt:    issue.created_at,
  };
}

function projectFromId(id) {
  const dash = id.lastIndexOf('-');
  return dash > 0 ? id.slice(0, dash) : id;
}

function normalisePriority(p) {
  if (p === 0 || p === 'P0' || p === '0') return 'high';
  if (p === 1 || p === 'P1' || p === '1') return 'high';
  if (p === 2 || p === 'P2' || p === '2') return 'medium';
  return 'low';
}

function normaliseStatus(s) {
  if (s === 'in_progress') return 'in_progress';
  if (s === 'closed' || s === 'completed') return 'completed';
  return 'pending';
}
