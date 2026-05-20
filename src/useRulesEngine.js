// useRulesEngine — React hook for the Rules Engine
//
// Calls /.netlify/functions/evaluate-rules after world state refreshes.
// Returns fired notifications so the UI can display them.
//
// Returns:
//   notifications  — array of { rule_id, channel, title, body, payload }
//   evaluatedAt    — ISO timestamp of last evaluation (null if never)
//   loading        — true while evaluation is in flight
//   error          — string if the function failed (null = ok)
//   evaluate       — call to trigger a manual evaluation

import { useState, useCallback } from 'react';

const EVALUATE_URL = '/.netlify/functions/evaluate-rules';

export function useRulesEngine() {
  const [notifications, setNotifications] = useState([]);
  const [evaluatedAt,   setEvaluatedAt]   = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);

  const evaluate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(EVALUATE_URL, { method: 'GET' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.fired?.length > 0) {
        // Prepend new notifications (most recent first)
        setNotifications(prev => [...data.fired, ...prev]);
      }
      setEvaluatedAt(data.evaluated_at ?? null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const dismiss = useCallback((index) => {
    setNotifications(prev => prev.filter((_, i) => i !== index));
  }, []);

  return { notifications, evaluatedAt, loading, error, evaluate, dismiss };
}
