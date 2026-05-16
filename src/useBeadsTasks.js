import { useState, useEffect, useCallback } from 'react';

export function useBeadsTasks() {
  const [tasks, setTasks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.fetch('/api/beads/ready');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      // Normalise bd --json shape to match our task model
      setTasks(raw.map(issue => ({
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
      })));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { tasks, loading, error, refresh: fetch };
}

// "HeroHeaven-4n7" → "HeroHeaven", "mnews-ayh" → "mnews"
function projectFromId(id) {
  const dash = id.lastIndexOf('-');
  return dash > 0 ? id.slice(0, dash) : id;
}

function normalisePriority(p) {
  if (p === 0 || p === 'P0') return 'high';
  if (p === 1 || p === 'P1') return 'high';
  if (p === 2 || p === 'P2') return 'medium';
  return 'low';
}

function normaliseStatus(s) {
  if (s === 'in_progress') return 'in_progress';
  if (s === 'closed' || s === 'completed') return 'completed';
  return 'pending';
}
