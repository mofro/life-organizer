import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWorldState } from './useWorldState.js';
import { useRulesEngine } from './useRulesEngine.js';
import { useDarkMode } from './useDarkMode.js';

// Re-assign 'today'/'tomorrow' from startISO using the browser's local date,
// then discard events outside that window. Falls back to the server date field
// for all-day events that have no startISO.
function rebucketByLocalDate(events) {
  const now         = new Date();
  const todayLabel  = now.toDateString();
  const tomorrow    = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowLabel = tomorrow.toDateString();

  return events
    .map(ev => {
      let bucket;
      if (ev.startISO) {
        const label = new Date(ev.startISO).toDateString();
        bucket = label === todayLabel ? 'today' : label === tomorrowLabel ? 'tomorrow' : null;
      } else {
        // All-day event: server date is YYYY-MM-DD, compare to local date strings
        const todayISO    = now.toLocaleDateString('en-CA');
        const tomorrowISO = tomorrow.toLocaleDateString('en-CA');
        bucket = ev.date === todayISO ? 'today' : ev.date === tomorrowISO ? 'tomorrow' : null;
      }
      return bucket ? { ...ev, date: bucket } : null;
    })
    .filter(Boolean);
}

// ─── Calendar sync hook ───────────────────────────────────────────────────────
// Fetches real Google Calendar events via the server-side calendar-sync function.
// Falls back to empty array when Google is not connected or the sync fails.
function useCalendarSync() {
  const [events, setEvents]       = useState([]);
  const [connected, setConnected] = useState(null); // null = loading, false = not connected, true = connected
  const [syncedAt, setSyncedAt]   = useState(null);

  const sync = useCallback(async () => {
    try {
      const res  = await fetch('/.netlify/functions/calendar-sync');
      const data = await res.json();
      setConnected(data.connected ?? false);
      setEvents(rebucketByLocalDate(data.events ?? []));
      if (data.synced_at) setSyncedAt(data.synced_at);
    } catch {
      setConnected(false);
      setEvents([]);
    }
  }, []);

  useEffect(() => { sync(); }, [sync]);

  return { events, connected, syncedAt, sync };
}

// ─── iCal feed sync hook ─────────────────────────────────────────────────────
// Fetches Apple/iCal events via ical-sync. Returns same shape as useCalendarSync.
function useICalSync() {
  const [events, setEvents]       = useState([]);
  const [connected, setConnected] = useState(false);

  const sync = useCallback(async () => {
    try {
      const res  = await fetch('/.netlify/functions/ical-sync');
      const data = await res.json();
      setConnected(data.connected ?? false);
      setEvents(rebucketByLocalDate(data.events ?? []));
    } catch {
      setConnected(false);
      setEvents([]);
    }
  }, []);

  useEffect(() => { sync(); }, [sync]);

  return { events, connected, sync };
}

// ─── iCal multi-feed hook ────────────────────────────────────────────────────
// Manages the ical_feeds array via /.netlify/functions/ical-feeds.
function useICalFeeds(onFeedsChange) {
  const [feeds, setFeeds]     = useState([]);
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState(null); // null | 'added' | 'removed' | 'error'

  useEffect(() => {
    fetch('/.netlify/functions/ical-feeds')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.feeds)) setFeeds(d.feeds); })
      .catch(() => {});
  }, []);

  const addFeed = useCallback(async (url) => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res  = await fetch('/.netlify/functions/ical-feeds', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setFeeds(data.feeds);
      setSaveMsg('added');
      onFeedsChange?.();
    } catch {
      setSaveMsg('error');
    } finally {
      setSaving(false);
    }
  }, [onFeedsChange]);

  const removeFeed = useCallback(async (url) => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res  = await fetch('/.netlify/functions/ical-feeds', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Remove failed');
      setFeeds(data.feeds);
      setSaveMsg('removed');
      onFeedsChange?.();
    } catch {
      setSaveMsg('error');
    } finally {
      setSaving(false);
    }
  }, [onFeedsChange]);

  return { feeds, saving, saveMsg, addFeed, removeFeed };
}

// ─── Claude recommendations hook ─────────────────────────────────────────────
// GET on mount restores the last saved recommendation silently (life-jeh/life-7j3).
// POST (ask()) generates a fresh recommendation via Claude (30-min server cache).
// dismissed state is lifted here, derived from item_feedback returned by GET/POST,
// so dismissals survive page reloads without any localStorage.
function useClaudeRecommendations() {
  const [focus, setFocus]           = useState(null);
  const [queue, setQueue]           = useState([]);
  const [overdue, setOverdue]       = useState([]);
  const [historyId, setHistoryId]   = useState(null);
  const [loading, setLoading]       = useState(false);
  const [restoring, setRestoring]   = useState(true);
  const [error, setError]           = useState(null);
  const [summary, setSummary]       = useState(null);
  const [cached, setCached]         = useState(false);
  const [cachedAt, setCachedAt]     = useState(null);
  const [stale, setStale]           = useState(false);
  const [emptyState, setEmptyState] = useState(false);
  const [dismissed, setDismissed]   = useState(() => new Set());

  // Populate state from any response shape (GET restore or POST fresh/cached).
  const applyData = useCallback((data) => {
    if (Array.isArray(data.recommendations)) {
      // Backward compat: old flat shape
      setFocus(null);
      setQueue(data.recommendations);
      setOverdue([]);
      setHistoryId(null);
      setDismissed(new Set());
    } else {
      setFocus(data.focus     ?? null);
      setQueue(data.queue     ?? []);
      setOverdue(data.overdue ?? []);
      setHistoryId(data.historyId ?? null);
      // Init dismissed set from item_feedback (persists dismissals across reloads)
      const prevDismissed = new Set(
        (data.item_feedback ?? [])
          .filter(fb => fb.action === 'dismissed' && fb.ref)
          .map(fb => fb.ref),
      );
      setDismissed(prevDismissed);
    }
    setSummary(data.summary      || null);
    setCached(data.cached        || false);
    setCachedAt(data.cachedAt    || null);
    setStale(data.stale          || false);
    setEmptyState(data.emptyState || false);
  }, []);

  // On mount: GET to restore last recommendation silently.
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch('/.netlify/functions/recommend');
        const data = await res.json();
        if (res.ok) applyData(data);
      } catch {
        // Silent — user can click "Ask Claude" manually
      } finally {
        setRestoring(false);
      }
    })();
  }, [applyData]);

  // ask(): POST to generate/refresh (uses server-side 30-min cache).
  const ask = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmptyState(false);
    try {
      const res  = await fetch('/.netlify/functions/recommend', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      applyData(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [applyData]);

  // dismiss(ref): hide a card + send PATCH feedback fire-and-forget.
  const dismiss = useCallback((ref, histId) => {
    setDismissed(prev => new Set([...prev, ref]));
    if (!histId) return;
    fetch('/.netlify/functions/recommendations', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ historyId: histId, ref, action: 'dismissed' }),
    }).catch(() => {});
  }, []);

  // accept(ref): send PATCH feedback fire-and-forget (no visual change).
  const accept = useCallback((ref, histId) => {
    if (!histId) return;
    fetch('/.netlify/functions/recommendations', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ historyId: histId, ref, action: 'accepted' }),
    }).catch(() => {});
  }, []);

  return {
    focus, queue, overdue, historyId,
    loading, restoring, error,
    summary, cached, cachedAt, stale, emptyState,
    dismissed, dismiss, accept,
    ask,
  };
}

// ─── Task persistence hook ────────────────────────────────────────────────────
// Loads tasks from Supabase (via the tasks Netlify function) on mount.
// On first load, migrates any existing localStorage tasks to Supabase.
// All mutations are optimistic — UI updates immediately, Supabase syncs in background.
function useTasks() {
  const [tasks, setTasks]             = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/tasks');
        const { tasks: remote = [] } = await res.json();

        if (remote.length === 0) {
          // One-time localStorage migration: if there are tasks in localStorage
          // and Supabase is empty, push them to Supabase then clear localStorage.
          const raw = localStorage.getItem('lo-tasks');
          const local = raw ? JSON.parse(raw) : [];
          if (local.length > 0) {
            const migrated = (await Promise.all(
              local.map(t =>
                fetch('/.netlify/functions/tasks', {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body:    JSON.stringify(t),
                })
                  .then(r => r.json())
                  .then(d => d.task)
                  .catch(() => null),
              ),
            )).filter(Boolean);
            setTasks(migrated);
            localStorage.removeItem('lo-tasks');
            console.log(`[tasks] Migrated ${migrated.length} tasks from localStorage to Supabase`);
            return;
          }
        }

        setTasks(remote);
      } catch {
        // Network error — fall back to localStorage so the UI isn't empty
        const raw = localStorage.getItem('lo-tasks');
        if (raw) { try { setTasks(JSON.parse(raw)); } catch {} }
      } finally {
        setTasksLoading(false);
      }
    })();
  }, []);

  const addTask = useCallback(async (formTask) => {
    // Use the form-supplied id (Date.now()) as a temporary key while the POST is in flight
    const tempId = formTask.id ?? Date.now();
    setTasks(prev => [{ ...formTask, id: tempId }, ...prev]);
    try {
      const res  = await fetch('/.netlify/functions/tasks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(formTask),
      });
      const { task } = await res.json();
      // Swap the temporary id for the Supabase-assigned bigint id
      setTasks(prev => prev.map(t => t.id === tempId ? task : t));
    } catch (e) {
      console.error('[tasks] addTask sync failed:', e);
    }
  }, []);

  const updateStatus = useCallback(async (id, status) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    try {
      await fetch(`/.netlify/functions/tasks?id=${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status }),
      });
    } catch (e) {
      console.error('[tasks] updateStatus sync failed:', e);
    }
  }, []);

  const deleteTask = useCallback(async (id) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    try {
      await fetch(`/.netlify/functions/tasks?id=${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error('[tasks] deleteTask sync failed:', e);
    }
  }, []);

  const completeTask = useCallback(async (id) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'completed' } : t));
    try {
      await fetch(`/.netlify/functions/tasks?id=${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'completed' }),
      });
    } catch (e) {
      console.error('[tasks] completeTask sync failed:', e);
    }
  }, []);

  // Schedule a task as a Google Calendar event.
  // Returns the calendarEventUrl on success so TaskRow can show a badge immediately.
  const scheduleTask = useCallback(async (id) => {
    try {
      const res  = await fetch('/.netlify/functions/schedule-task', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ taskId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Persist calendarEventUrl into task state so the badge shows without reload
      if (data.calendarEventUrl) {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, calendarEventUrl: data.calendarEventUrl } : t));
      }
      return data.calendarEventUrl ?? null;
    } catch (e) {
      console.error('[tasks] scheduleTask failed:', e);
      throw e; // re-throw so TaskRow can show an error state
    }
  }, []);

  return { tasks, tasksLoading, addTask, updateStatus, deleteTask, completeTask, scheduleTask };
}

// ─── Dark mode toggle ─────────────────────────────────────────────────────────
function DarkModeToggle({ mode, setMode }) {
  const options = [
    { key: 'light', label: '☀' },
    { key: 'auto',  label: '⊙' },
    { key: 'dark',  label: '☾' },
  ];
  return (
    <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
      {options.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setMode(key)}
          title={key.charAt(0).toUpperCase() + key.slice(1)}
          className={`px-2 py-1 rounded-md text-xs transition-colors
            ${mode === key
              ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm'
              : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Collapsible section wrapper ─────────────────────────────────────────────
function Section({ title, subtitle, defaultOpen = true, children, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</span>
          {subtitle && <span className="text-xs text-gray-400 dark:text-gray-500">{subtitle}</span>}
          {badge != null && badge > 0 && (
            <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full px-1.5 py-0.5 font-medium">{badge}</span>
          )}
        </div>
        <span className={`text-gray-400 dark:text-gray-500 text-xs transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ─── Source badge ─────────────────────────────────────────────────────────────
const SOURCE_STYLE = {
  manual:   { label: 'manual',   cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400' },
  beads:    { label: 'beads',    cls: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' },
  email:    { label: 'email',    cls: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  calendar: { label: 'calendar', cls: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
};

function SourceBadge({ source, sourceUrl }) {
  const style = SOURCE_STYLE[source] || SOURCE_STYLE.manual;
  if (sourceUrl) {
    return (
      <a href={sourceUrl} target="_blank" rel="noreferrer"
        className={`text-xs px-1.5 py-0.5 rounded font-medium underline-offset-1 hover:underline ${style.cls}`}
        onClick={e => e.stopPropagation()}
      >{style.label} ↗</a>
    );
  }
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${style.cls}`}>{style.label}</span>;
}

// ─── Stat cards ───────────────────────────────────────────────────────────────
// Accepts the merged manual + beads task array.
// Beads statuses are 'open' | 'in_progress'; manual are 'pending' | 'in_progress' | 'completed'.
// We normalise 'open' → 'pending' for counting so the cards are source-agnostic.
function QuickStats({ tasks, filter, onFilterChange }) {
  const counts = tasks.reduce((acc, t) => {
    const key = t.status === 'open' ? 'pending' : t.status;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const now = new Date();
  const overdue = tasks.filter(t => {
    const active = t.status !== 'completed' && t.status !== 'cancelled';
    return t.deadline && new Date(t.deadline) < now && active;
  }).length;

  const stats = [
    { label: 'Pending', filterKey: 'pending',    value: counts.pending    || 0, color: 'text-blue-600',   ring: 'ring-blue-400'   },
    { label: 'Doing',   filterKey: 'in_progress', value: counts.in_progress || 0, color: 'text-yellow-600', ring: 'ring-yellow-400' },
    { label: 'Done',    filterKey: 'completed',   value: counts.completed  || 0, color: 'text-green-600',  ring: 'ring-green-400'  },
    { label: 'Overdue', filterKey: 'overdue',     value: overdue,                color: 'text-red-600',    ring: 'ring-red-400'    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(({ label, filterKey, value, color, ring }) => {
        const active = filter === filterKey;
        return (
          <button
            key={label}
            onClick={() => onFilterChange(active ? 'all' : filterKey)}
            className={`bg-white dark:bg-gray-900 rounded-lg border p-3 text-center transition-all cursor-pointer hover:shadow-sm
              ${active ? `border-transparent ring-2 ${ring}` : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}
          >
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
          </button>
        );
      })}
    </div>
  );
}

// ─── Recommendation card ──────────────────────────────────────────────────────
function RecommendationCard({ task, onComplete }) {
  const priorityColor = { high: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', medium: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800', low: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' };
  return (
    <div className={`border rounded-lg p-3 flex items-start gap-3 ${priorityColor[task.priority] || 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">{task.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{task.reason}</p>
        <div className="flex gap-2 mt-1 flex-wrap">
          {task.timeRequired && (
            <span className="text-xs text-gray-400 dark:text-gray-500">{task.timeRequired >= 60 ? `${Math.round(task.timeRequired / 60)}h` : `${task.timeRequired}m`}</span>
          )}
          {task.deadline && (
            <span className="text-xs text-gray-400 dark:text-gray-500">due {new Date(task.deadline).toLocaleDateString()}</span>
          )}
          <SourceBadge source={task.source} sourceUrl={task.sourceUrl} />
        </div>
      </div>
      {task.source === 'beads' ? (
        <span className="text-xs text-gray-300 dark:text-gray-600 shrink-0 pt-0.5">bd close {task.beadsId}</span>
      ) : (
        <button
          onClick={() => onComplete(task.id)}
          className="text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700 shrink-0"
        >
          Done
        </button>
      )}
    </div>
  );
}

// ─── Portfolio recommendation components ─────────────────────────────────────

function FocusCard({ item, historyId, dismissed, onDismiss, onAccept }) {
  const ref = item ? (item.source === 'beads' ? `beads:${item.beadsId}` : `task:${item.id}`) : null;

  if (!item || (ref && dismissed?.has(ref))) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500 py-2 text-center">
        Nothing fits your next block — mark a window as free or add a task.
      </p>
    );
  }

  return (
    <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg overflow-hidden">
      <div className="p-4">
        <p className="text-xs font-medium text-indigo-500 dark:text-indigo-400 uppercase tracking-wide mb-0.5">Focus Now</p>
        <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{item.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.reason}</p>
        <div className="flex gap-2 mt-2 flex-wrap items-center">
          {item.window && (
            <span className="text-xs bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 rounded px-1.5 py-0.5">{item.window}</span>
          )}
          {item.timeRequired && (
            <span className="text-xs text-gray-400 dark:text-gray-500">{item.timeRequired >= 60 ? `${Math.round(item.timeRequired / 60)}h` : `${item.timeRequired}m`}</span>
          )}
          <SourceBadge source={item.source} sourceUrl={item.sourceUrl} />
        </div>
        {item.source === 'beads' && (
          <div className="mt-2 flex gap-2">
            <CopyCommand cmd={`bdg claim ${item.beadsId}`} />
          </div>
        )}
      </div>
      <div className="flex border-t border-indigo-100 dark:border-indigo-800/50 divide-x divide-indigo-100 dark:divide-indigo-800/50">
        <button
          onClick={() => onAccept?.(ref, historyId)}
          className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] text-xs text-gray-400 dark:text-gray-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/10 transition-colors"
        >
          👍 <span>Good</span>
        </button>
        <button
          onClick={() => onDismiss?.(ref, historyId)}
          className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
        >
          👎 <span>Skip</span>
        </button>
      </div>
    </div>
  );
}

function QueueCard({ item, historyId, dismissed, onDismiss, onAccept }) {
  const ref = item.source === 'beads' ? `beads:${item.beadsId}` : `task:${item.id}`;

  if (dismissed?.has(ref)) return null;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2.5">
        <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{item.title}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{item.reason}</p>
        <div className="flex gap-2 mt-1.5 flex-wrap items-center">
          {item.window && (
            <span className="text-xs text-gray-400 dark:text-gray-500">{item.window}</span>
          )}
          <SourceBadge source={item.source} sourceUrl={item.sourceUrl} />
          {item.source === 'beads' && (
            <CopyCommand cmd={`bdg close ${item.beadsId}`} />
          )}
        </div>
      </div>
      <div className="flex border-t border-gray-100 dark:border-gray-700/60 divide-x divide-gray-100 dark:divide-gray-700/60">
        <button
          onClick={() => onAccept?.(ref, historyId)}
          className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] text-xs text-gray-300 dark:text-gray-600 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/10 transition-colors"
        >
          👍 <span>Good</span>
        </button>
        <button
          onClick={() => onDismiss?.(ref, historyId)}
          className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] text-xs text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
        >
          👎 <span>Skip</span>
        </button>
      </div>
    </div>
  );
}

// ─── Calendar feeds manager ───────────────────────────────────────────────────
function feedLabel(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('outlook') || host.includes('office365')) return 'Outlook';
    if (host.includes('icloud') || host.includes('caldav.icloud')) return 'iCloud';
    if (host.includes('google'))   return 'Google';
    if (host.includes('fastmail')) return 'Fastmail';
    if (host.includes('yahoo'))    return 'Yahoo';
    // Capitalize first segment of hostname as a reasonable fallback
    const base = host.replace(/^www\./, '').split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return 'Calendar';
  }
}

function ICalFeedsManager({ feeds, saving, saveMsg, onAdd, onRemove }) {
  const [input, setInput] = useState('');

  const handleAdd = async () => {
    const url = input.trim();
    if (!url) return;
    await onAdd(url);
    setInput('');
  };

  return (
    <div className="space-y-2">
      {feeds.length > 0 && (
        <div className="space-y-1">
          {feeds.map(url => (
            <div key={url} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full shrink-0"></span>
              <span className="text-xs text-green-700 dark:text-green-400 font-medium">{feedLabel(url)}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500 truncate flex-1">{new URL(url).hostname}</span>
              <button
                onClick={() => onRemove(url)}
                disabled={saving}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 shrink-0"
              >Remove</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="url"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Paste iCal URL (webcal:// or https://)"
          className="flex-1 text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder-gray-300 dark:placeholder-gray-600"
        />
        <button
          onClick={handleAdd}
          disabled={saving || !input.trim()}
          className="px-3 py-1.5 text-xs font-medium bg-gray-800 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? '…' : 'Add'}
        </button>
      </div>
      {saveMsg === 'added'   && <p className="text-xs text-green-600">Added — syncing…</p>}
      {saveMsg === 'removed' && <p className="text-xs text-gray-400">Removed.</p>}
      {saveMsg === 'error'   && <p className="text-xs text-red-500">Failed — check the URL and try again</p>}
    </div>
  );
}

// ─── Conversation Intake ──────────────────────────────────────────────────────

function useIntake() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const submit = useCallback(async ({ text, source, context, project }) => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/.netlify/functions/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source, context, project: project || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      setResult({ ...data, project: project || null });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }, []);

  const reset = useCallback(() => { setResult(null); setError(null); }, []);

  return { submitting, error, result, submit, reset };
}

function IntakeItem({ item, state, onApprove, onDismiss }) {
  const priorityLabel = { 0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
  const destCls = item.destination === 'beads'
    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
    : 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300';

  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm text-gray-800 dark:text-gray-200 font-medium">{item.title}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${destCls}`}>
            {item.destination === 'beads' ? 'beads' : 'task'}
          </span>
          {item.content?.priority != null && (
            <span className="text-[10px] px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-500 dark:text-gray-400">
              {priorityLabel[item.content.priority] ?? `P${item.content.priority}`}
            </span>
          )}
          {item.thirdParty && item.content?.owner && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">→ {item.content.owner}</span>
          )}
          {item.content?.deadline && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">due {item.content.deadline}</span>
          )}
        </div>
        {state?.error && <p className="text-xs text-red-500 mt-0.5">{state.error}</p>}
        {state?.createdId && (
          <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Created: {state.createdId}</p>
        )}
      </div>
      {onApprove && !state?.createdId && (
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onApprove}
            disabled={state?.status === 'creating'}
            className="text-xs px-2 py-1 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded hover:bg-green-100 dark:hover:bg-green-900/40 disabled:opacity-40"
          >
            {state?.status === 'creating' ? '…' : 'Create'}
          </button>
          <button
            onClick={onDismiss}
            className="text-xs px-2 py-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          >✕</button>
        </div>
      )}
    </div>
  );
}

function ConversationIntakeResult({ result, onReset }) {
  const { extractions, truncated, project } = result;
  const [creationState, setCreationState] = useState({});
  const [dismissed, setDismissed] = useState(new Set());
  const [showLowConf, setShowLowConf] = useState(false);
  const autoFiredRef = useRef(false);

  const isAutoCreate = (item) =>
    item.confidence >= 0.80 && !item.thirdParty && item.type !== 'QUESTION';

  const autoItems   = extractions.filter(isAutoCreate);
  const reviewItems = extractions.filter(
    item => !isAutoCreate(item) && item.type !== 'QUESTION' && item.confidence >= 0.50
  );
  const questions   = extractions.filter(item => item.type === 'QUESTION');
  const lowConf     = extractions.filter(
    item => item.type !== 'QUESTION' && item.confidence < 0.50
  );

  const createItem = useCallback(async (idx, item) => {
    setCreationState(prev => ({ ...prev, [idx]: { status: 'creating' } }));
    try {
      const isBeads = item.destination === 'beads';
      const url  = isBeads ? '/.netlify/functions/beads-create' : '/.netlify/functions/tasks';
      const body = isBeads
        ? {
            title:       item.title,
            description: item.content?.description,
            priority:    item.content?.priority,
            labels:      project ? [project] : undefined,
          }
        : {
            title:    item.title,
            priority: item.content?.priority <= 1 ? 'high' : item.content?.priority >= 3 ? 'low' : 'medium',
            deadline: item.content?.deadline,
            source:   'intake',
          };

      const res  = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

      const createdId = data.id ?? data.task?.id ?? null;
      setCreationState(prev => ({ ...prev, [idx]: { status: 'created', createdId } }));
    } catch (e) {
      setCreationState(prev => ({ ...prev, [idx]: { status: 'error', error: e.message } }));
    }
  }, [project]);

  useEffect(() => {
    if (autoFiredRef.current) return;
    autoFiredRef.current = true;
    extractions.forEach((item, idx) => {
      if (isAutoCreate(item)) createItem(idx, item);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      {truncated && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Conversation was trimmed — only the first ~25k tokens were analysed.
        </p>
      )}

      {autoItems.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
            Created automatically
          </p>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {autoItems.map((item) => {
              const idx = extractions.indexOf(item);
              return <IntakeItem key={idx} item={item} state={creationState[idx]} />;
            })}
          </div>
        </div>
      )}

      {reviewItems.some((item) => !dismissed.has(extractions.indexOf(item))) && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
            Needs review
          </p>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {reviewItems.map((item) => {
              const idx = extractions.indexOf(item);
              if (dismissed.has(idx)) return null;
              const state = creationState[idx];
              return (
                <IntakeItem
                  key={idx}
                  item={item}
                  state={state}
                  onApprove={state?.status === 'created' ? null : () => createItem(idx, item)}
                  onDismiss={() => setDismissed(prev => new Set([...prev, idx]))}
                />
              );
            })}
          </div>
        </div>
      )}

      {questions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
            Questions raised
          </p>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {questions.map((item) => (
              <IntakeItem key={extractions.indexOf(item)} item={item} />
            ))}
          </div>
        </div>
      )}

      {lowConf.length > 0 && (
        <div>
          <button
            onClick={() => setShowLowConf(v => !v)}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {showLowConf ? '▾' : '▸'} Low confidence ({lowConf.length})
          </button>
          {showLowConf && (
            <div className="mt-1 divide-y divide-gray-100 dark:divide-gray-800 opacity-60">
              {lowConf.map((item) => (
                <IntakeItem key={extractions.indexOf(item)} item={item} />
              ))}
            </div>
          )}
        </div>
      )}

      {extractions.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          No actionable items found in the text.
        </p>
      )}

      <button
        onClick={onReset}
        className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline underline-offset-2"
      >
        Capture another
      </button>
    </div>
  );
}

function ConversationIntakeWidget() {
  const { submitting, error, result, submit, reset } = useIntake();
  const [text, setText]       = useState('');
  const [source, setSource]   = useState('claude-session');
  const [context, setContext] = useState('mixed');
  const [project, setProject] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    submit({ text, source, context, project });
  };

  const handleReset = () => { reset(); setText(''); };

  if (result) return <ConversationIntakeResult result={result} onReset={handleReset} />;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste a Claude session, note, or any text with tasks and commitments…"
        rows={6}
        className="w-full text-sm font-mono bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={source}
          onChange={e => setSource(e.target.value)}
          className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-gray-700 dark:text-gray-300"
        >
          <option value="claude-session">Claude session</option>
          <option value="note">Note</option>
          <option value="voice-transcript">Voice transcript</option>
          <option value="email">Email</option>
          <option value="form">Other</option>
        </select>
        <select
          value={context}
          onChange={e => setContext(e.target.value)}
          className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-gray-700 dark:text-gray-300"
        >
          <option value="mixed">Mixed</option>
          <option value="work">Work</option>
          <option value="personal">Personal</option>
        </select>
        <input
          type="text"
          value={project}
          onChange={e => setProject(e.target.value)}
          placeholder="project label"
          className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-gray-700 dark:text-gray-300 w-28 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="ml-auto px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Extracting…' : 'Extract tasks'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}

function localTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── Calendar section ─────────────────────────────────────────────────────────
function CalendarContent({ events, googleConnected, icalConnected, loading }) {
  const typeStyle = { meeting: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', focus: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' };
  const connected = googleConnected || icalConnected;

  if (loading) {
    return <p className="text-xs text-gray-300 pt-1">Loading calendar…</p>;
  }

  if (!connected) {
    return (
      <p className="text-xs text-gray-400 pt-1">
        Connect Google or add an iCal URL in <span className="font-medium">Settings</span>.
      </p>
    );
  }

  const todayEvents    = events.filter(e => e.date === 'today');
  const tomorrowEvents = events.filter(e => e.date === 'tomorrow');
  const hasEvents      = todayEvents.length > 0 || tomorrowEvents.length > 0;

  return (
    <div className="space-y-3">
      {[['Today', todayEvents], ['Tomorrow', tomorrowEvents]].map(([label, evs]) =>
        evs.length > 0 && (
          <div key={label}>
            <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-1.5">{label}</p>
            <div className="space-y-1">
              {evs.map(ev => (
                <div key={ev.id} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 dark:text-gray-500 w-20 shrink-0">
                    {localTime(ev.startISO) ?? ev.start}–{localTime(ev.endISO) ?? ev.end}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeStyle[ev.type] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>{ev.title}</span>
                </div>
              ))}
            </div>
          </div>
        )
      )}
      {!hasEvents && <p className="text-xs text-gray-300 pt-1">No events today or tomorrow.</p>}
    </div>
  );
}

// ─── Task form ────────────────────────────────────────────────────────────────
function TaskForm({ onAdd }) {
  const formRef = useRef(null);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    const data = new FormData(formRef.current);
    const title = data.get('title')?.trim();
    if (!title) return;

    onAdd({
      id: Date.now(),
      title,
      category: data.get('category') || 'general',
      priority: data.get('priority') || 'medium',
      timeRequired: parseInt(data.get('timeRequired')) || null,
      deadline: data.get('deadline') || null,
      status: 'pending',
      source: 'manual',
      sourceUrl: null,
      createdAt: new Date().toISOString(),
    });

    formRef.current.reset();
  }, [onAdd]);

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-2">
      <input
        name="title"
        type="text"
        placeholder="Task title..."
        className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        autoComplete="off"
      />
      <div className="grid grid-cols-2 gap-2">
        <select name="category" className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
          <option value="general">General</option>
          <option value="work">Work</option>
          <option value="personal">Personal</option>
          <option value="health">Health</option>
          <option value="learning">Learning</option>
        </select>
        <select name="priority" className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
          <option value="medium">Medium priority</option>
          <option value="high">High priority</option>
          <option value="low">Low priority</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          name="timeRequired"
          type="number"
          placeholder="Time (minutes)"
          min="1"
          className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        />
        <input
          name="deadline"
          type="date"
          className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        />
      </div>
      <button
        type="submit"
        className="w-full bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
      >
        Add Task
      </button>
    </form>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────
function TaskRow({ task, onStatusChange, onDelete, onSchedule }) {
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState(false);

  const statusColor   = { pending: 'text-gray-400', in_progress: 'text-yellow-500', completed: 'text-green-500' };
  const priorityBadge = { high: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300', low: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400' };
  const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'completed';

  const handleSchedule = useCallback(async () => {
    setScheduling(true);
    setScheduleError(false);
    try {
      await onSchedule(task.id);
    } catch {
      setScheduleError(true);
      setTimeout(() => setScheduleError(false), 3000);
    } finally {
      setScheduling(false);
    }
  }, [onSchedule, task.id]);

  return (
    <div className={`flex items-start gap-3 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0 ${task.status === 'completed' ? 'opacity-50' : ''}`}>
      <select
        value={task.status}
        onChange={e => onStatusChange(task.id, e.target.value)}
        className={`text-xs border-0 bg-transparent cursor-pointer focus:outline-none mt-0.5 ${statusColor[task.status]}`}
      >
        <option value="pending">○</option>
        <option value="in_progress">◐</option>
        <option value="completed">●</option>
      </select>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${task.status === 'completed' ? 'line-through text-gray-400 dark:text-gray-600' : 'text-gray-800 dark:text-gray-200'}`}>{task.title}</p>
        <div className="flex flex-wrap gap-1.5 mt-1">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityBadge[task.priority]}`}>{task.priority}</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">{task.category}</span>
          {task.timeRequired && <span className="text-xs text-gray-400 dark:text-gray-500">{task.timeRequired >= 60 ? `${Math.round(task.timeRequired / 60)}h` : `${task.timeRequired}m`}</span>}
          {task.deadline && (
            <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              {isOverdue ? 'overdue · ' : ''}{new Date(task.deadline).toLocaleDateString()}
            </span>
          )}
          <SourceBadge source={task.source || 'manual'} sourceUrl={task.sourceUrl} />

          {/* Calendar scheduling — only for active tasks */}
          {task.status !== 'completed' && onSchedule && (
            task.calendarEventUrl
              ? <a
                  href={task.calendarEventUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-purple-500 hover:text-purple-700"
                  onClick={e => e.stopPropagation()}
                  title="View in Google Calendar"
                >📅</a>
              : scheduleError
                ? <span className="text-xs text-red-400">failed</span>
                : <button
                    onClick={handleSchedule}
                    disabled={scheduling}
                    className="text-xs text-gray-300 dark:text-gray-600 hover:text-purple-500 disabled:opacity-40 transition-colors"
                    title="Schedule as calendar event"
                  >{scheduling ? '…' : '📅'}</button>
          )}
        </div>
      </div>
      <button onClick={() => onDelete(task.id)} className="text-gray-300 dark:text-gray-600 hover:text-red-400 text-xs shrink-0 mt-0.5">✕</button>
    </div>
  );
}

// ─── Unified task list ────────────────────────────────────────────────────────
// Merges manual tasks (open_tasks) and Beads issues (beads_ready) into one
// sorted list. Sort order: overdue → deadline asc (nulls last) → priority → source.
// Dispatches to TaskRow (manual) or BeadsTaskRow (beads) based on task.source.

const PRIORITY_ORDER = { high: 1, medium: 2, low: 3 };

function sortUnified(tasks) {
  const now = new Date();
  return [...tasks].sort((a, b) => {
    const aActive  = a.status !== 'completed' && a.status !== 'cancelled';
    const bActive  = b.status !== 'completed' && b.status !== 'cancelled';
    const aOverdue = aActive && a.deadline && new Date(a.deadline) < now;
    const bOverdue = bActive && b.deadline && new Date(b.deadline) < now;

    // 1. Overdue tasks surface first
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    // 2. Deadline ascending (nulls last)
    if (a.deadline && b.deadline) {
      const diff = new Date(a.deadline) - new Date(b.deadline);
      if (diff !== 0) return diff;
    } else if (a.deadline) return -1;
    else if (b.deadline)   return  1;

    // 3. Priority (high < medium < low)
    const ap = PRIORITY_ORDER[a.priority] ?? 2;
    const bp = PRIORITY_ORDER[b.priority] ?? 2;
    if (ap !== bp) return ap - bp;

    // 4. Stable: manual tasks before beads at equal priority
    return (a.source === 'beads' ? 1 : 0) - (b.source === 'beads' ? 1 : 0);
  });
}

// Groups beadsReady tasks by their parent feature for the Hierarchy view.
// Returns { groups: [{ featureId, featureTitle, featurePriority, tasks[] }], standalone: [] }
// Feature groups sorted by featurePriority ASC (ties: title alphabetically).
// Tasks within each group sorted by priority. Standalone tasks sorted by priority.
function groupByFeature(beads) {
  const featureMap = new Map();
  const standalone = [];

  for (const task of beads) {
    if (task.parentFeatureId) {
      if (!featureMap.has(task.parentFeatureId)) {
        featureMap.set(task.parentFeatureId, {
          featureId:       task.parentFeatureId,
          featureTitle:    task.parentFeatureTitle,
          featurePriority: task.parentPriority,
          tasks:           [],
        });
      }
      featureMap.get(task.parentFeatureId).tasks.push(task);
    } else {
      standalone.push(task);
    }
  }

  const groups = [...featureMap.values()].sort((a, b) => {
    const pa = a.featurePriority ?? 99;
    const pb = b.featurePriority ?? 99;
    if (pa !== pb) return pa - pb;
    return (a.featureTitle || '').localeCompare(b.featureTitle || '');
  });

  for (const group of groups) {
    group.tasks.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));
  }
  standalone.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));

  return { groups, standalone };
}

function UnifiedTaskList({
  tasks, beadsReady,
  onStatusChange, onDelete, onSchedule,
  filter, onFilterChange,
  worldError, worldLoading, beadsStale, syncedAt, onRefresh,
}) {
  const [tab, setTab]   = useState('beads'); // 'manual' | 'beads' | 'all'
  const [open, setOpen] = useState(false);

  // Auto-open and switch to All tab when a QuickStats filter is applied —
  // the stat buttons are global, so show results across all sources.
  useEffect(() => {
    if (filter === 'active' || filter === 'all') return;
    setOpen(true);
    setTab('all');
  }, [filter]);
  const now = new Date();
  const all = [...tasks, ...beadsReady];

  // Tab → source slice (beads tab uses hierarchy renderer, not this flat filter)
  const byTab = tab === 'manual' ? all.filter(t => t.source !== 'beads')
              : all;

  // Status filter (from QuickStats) applied within the active tab
  const filtered = byTab.filter(t => {
    const active  = t.status !== 'completed' && t.status !== 'cancelled';
    const pending = t.status === 'pending' || t.status === 'open';
    if (filter === 'pending')     return pending;
    if (filter === 'in_progress') return t.status === 'in_progress';
    if (filter === 'completed')   return t.status === 'completed';
    if (filter === 'overdue')     return active && t.deadline && new Date(t.deadline) < now;
    if (filter === 'active')      return active;
    return true;
  });

  const sorted = sortUnified(filtered);

  // Badge counts: active items per tab (ignore current status filter so badges always show real totals)
  const countManual = all.filter(t => t.source !== 'beads' && t.status !== 'completed' && t.status !== 'cancelled').length;
  const countBeads  = all.filter(t => t.source === 'beads').length;
  const countAll    = all.filter(t => t.status !== 'completed' && t.status !== 'cancelled').length;

  const TABS = [
    { key: 'manual', label: 'Manual', count: countManual },
    ...(countBeads > 0 ? [{ key: 'beads', label: 'Beads', count: countBeads }] : []),
    { key: 'all',    label: 'All',    count: countAll    },
  ];

  const filterLabel = {
    all: 'All', active: 'Active', pending: 'Pending',
    in_progress: 'Doing', completed: 'Done', overdue: 'Overdue',
  };

  const syncLabel = beadsStale
    ? '⚠ stale'
    : syncedAt
      ? `synced ${new Date(syncedAt).toLocaleTimeString()}`
      : undefined;

  const EMPTY = {
    manual: 'No tasks yet — add one above',
    beads:  'No unblocked Beads issues.',
    all:    'No tasks yet — add one above',
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* Header — title + collapse toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Tasks</span>
          {countAll > 0 && (
            <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full px-1.5 py-0.5 font-medium">{countAll}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {syncLabel && (
            <span className={`text-xs ${beadsStale ? 'text-amber-500' : 'text-gray-300 dark:text-gray-600'}`}>{syncLabel}</span>
          )}
          <span className={`text-gray-400 dark:text-gray-500 text-xs transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▾</span>
        </div>
      </button>

      {open && <>
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-3 pb-2 border-t border-b border-gray-100 dark:border-gray-800">
          {TABS.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
                ${tab === key
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            >
              {label}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none
                  ${tab === key ? 'bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-200' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                  {count}
                </span>
              )}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {onRefresh && (
              <button onClick={onRefresh} className="text-xs text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400" title="Refresh">↺</button>
            )}
          </div>
        </div>

        <div className="p-4">
        {/* Active filter chip */}
        {filter !== 'active' && filter !== 'all' && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-full px-2 py-0.5">
              {filterLabel[filter]}
            </span>
            <button onClick={() => onFilterChange('active')} className="text-xs text-gray-400 hover:text-gray-600">✕ clear</button>
          </div>
        )}

        {worldError && (
          <p className="text-xs text-red-400 mb-2">Beads sync failed: {worldError}</p>
        )}
        {worldLoading && all.length === 0 && (
          <p className="text-xs text-gray-400 py-1">Syncing…</p>
        )}

        {tab === 'beads' ? (() => {
          const { groups, standalone } = groupByFeature(filtered.filter(t => t.source === 'beads'));
          if (groups.length === 0 && standalone.length === 0) {
            return <p className="text-sm text-gray-400 text-center py-6">{EMPTY.hierarchy}</p>;
          }
          return (
            <div>
              {groups.map(({ featureId, featureTitle, featurePriority, tasks }) => (
                <div key={featureId} className="mb-4">
                  <div className="flex items-center gap-2 px-1 py-1.5 mb-1 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Feature</span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200 flex-1">{featureTitle}</span>
                    {featurePriority !== null && (
                      <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded px-1.5 py-0.5 font-mono">P{featurePriority}</span>
                    )}
                  </div>
                  <div className="pl-3">
                    {tasks.map(task => <BeadsTaskRow key={task.id} task={task} />)}
                  </div>
                </div>
              ))}
              {standalone.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 px-1 py-1.5 mb-1 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Standalone Tasks</span>
                  </div>
                  <div className="pl-3">
                    {standalone.map(task => <BeadsTaskRow key={task.id} task={task} />)}
                  </div>
                </div>
              )}
            </div>
          );
        })() : sorted.length === 0 && !worldLoading ? (
          <p className="text-sm text-gray-400 text-center py-6">{EMPTY[tab]}</p>
        ) : (
          sorted.map(task =>
            task.source === 'beads'
              ? <BeadsTaskRow key={task.id} task={task} />
              : <TaskRow key={task.id} task={task} onStatusChange={onStatusChange} onDelete={onDelete} onSchedule={onSchedule} />
          )
        )}
        </div>
      </>}
    </div>
  );
}

// ─── Beads task row — accordion with lazy-loaded details + write-back ────────
// Copy-to-clipboard pill for a terminal command.
// Shows the command as monospace; clicking copies and flashes "Copied!".
function CopyCommand({ cmd }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [cmd]);
  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      className="flex items-center gap-1.5 text-xs font-mono bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
    >
      <span>{copied ? '✓ copied' : cmd}</span>
    </button>
  );
}

function BeadsTaskRow({ task }) {
  const [open, setOpen]           = useState(false);
  const [detail, setDetail]       = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      setDetailLoading(true);
      try {
        const res = await window.fetch(`/.netlify/functions/beads-show?id=${task.beadsId}`);
        if (res.ok) setDetail(await res.json());
      } catch {}
      setDetailLoading(false);
    }
  }, [open, detail, task.beadsId]);

  const priorityBadge = { high: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300', low: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400' };

  return (
    <div className="border-b border-gray-100 dark:border-gray-800 last:border-0">
      {/* Summary row — click to expand */}
      <button
        onClick={toggle}
        className="w-full flex items-start gap-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded transition-colors"
      >
        <span className={`text-xs mt-0.5 transition-transform duration-150 text-indigo-300 dark:text-indigo-500 ${open ? 'rotate-90' : ''}`}>▶</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{task.title}</p>
            <span className="text-xs text-gray-300 dark:text-gray-600 shrink-0">{task.beadsId}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityBadge[task.priority]}`}>{task.priority}</span>
            {task.status === 'in_progress' && (
              <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">▶ active</span>
            )}
            {task.issueType && task.issueType !== 'task' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{task.issueType}</span>
            )}
            {task.project && <span className="text-xs text-gray-400 dark:text-gray-500">{task.project}</span>}
            {task.blockedBy?.length > 0 && (
              <span className="text-xs text-orange-500">blocked by {task.blockedBy.length}</span>
            )}
            <SourceBadge source="beads" sourceUrl={task.sourceUrl} />
          </div>
        </div>
      </button>

      {/* Detail panel */}
      {open && (
        <div className="ml-6 mb-3 space-y-2">
          {detailLoading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : detail ? (
            <>
              {detail.description && (
                <DetailBlock label="Description" text={detail.description} />
              )}
              {detail.design && (
                <DetailBlock label="Design" text={detail.design} />
              )}
              {detail.notes && (
                <DetailBlock label="Notes" text={detail.notes} />
              )}
              {detail.acceptance && (
                <DetailBlock label="Acceptance" text={detail.acceptance} />
              )}
              {detail.external_ref && (
                <ExternalRef value={detail.external_ref} description={detail.description} />
              )}
            </>
          ) : (
            <p className="text-xs text-gray-400">Could not load details — is the local server running?</p>
          )}

          {/* Terminal command helpers — copy to clipboard, run locally via bdg */}
          <div className="pt-1 flex gap-2 flex-wrap">
            <CopyCommand cmd={`bdg claim ${task.beadsId}`} />
            <CopyCommand cmd={`bdg close ${task.beadsId}`} />
          </div>
        </div>
      )}
    </div>
  );
}

function DetailBlock({ label, text }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  );
}

function ExternalRef({ value, description }) {
  // Try to pull a full URL from the description first (e.g. "Tracks https://github.com/...")
  const urlMatch = description?.match(/https?:\/\/[^\s)]+/);
  const url = urlMatch?.[0] ?? null;

  return (
    <div>
      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">External ref</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer"
          className="text-xs text-sky-600 dark:text-sky-400 hover:underline break-all"
        >{value} ↗</a>
      ) : (
        <span className="text-xs text-gray-600 dark:text-gray-400">{value}</span>
      )}
    </div>
  );
}

// ─── Google OAuth connection status hook ─────────────────────────────────────
function useGoogleAuth() {
  const [status, setStatus] = useState('unknown'); // 'unknown' | 'connected' | 'disconnected' | 'error'
  const [errorReason, setErrorReason] = useState(null);

  useEffect(() => {
    // Handle redirect back from Google consent screen
    const params = new URLSearchParams(window.location.search);
    const googleParam = params.get('google');
    if (googleParam === 'connected') {
      setStatus('connected');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    if (googleParam === 'error') {
      setStatus('error');
      setErrorReason(params.get('reason'));
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    // Check DB status on mount
    fetch('/.netlify/functions/auth-google-status')
      .then(r => r.json())
      .then(d => setStatus(d.connected ? 'connected' : 'disconnected'))
      .catch(() => setStatus('disconnected'));
  }, []);

  const connect = useCallback(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    const redirectUri = `${window.location.origin}/.netlify/functions/auth-google-callback`;
    const scope = [
      'https://www.googleapis.com/auth/calendar.events', // read + create/update/delete events
      'https://www.googleapis.com/auth/gmail.readonly',
    ].join(' ');
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    window.location.href = authUrl.toString();
  }, []);

  return { status, errorReason, connect };
}

// ─── Main app ─────────────────────────────────────────────────────────────────
export default function LifeOrganizer() {
  const [filter, setFilter] = useState('active');
  const [darkMode, setDarkMode] = useDarkMode();

  // Tasks — Supabase-backed, with optimistic updates and one-time localStorage migration.
  const { tasks, tasksLoading, addTask, updateStatus, deleteTask, completeTask, scheduleTask } = useTasks();

  // World State: reads from Supabase (via Netlify function) — source of truth in production.
  const { beadsReady, derived, syncedAt, beadsError: beadsStale, loading: worldLoading, error: worldError, refresh: refreshWorld } = useWorldState();
  // Rules Engine: evaluates World State after each sync, returns fired notifications.
  const { notifications, evaluatedAt, loading: rulesLoading, error: rulesError, evaluate, dismiss } = useRulesEngine();
  // Google OAuth connection state (for Calendar + Gmail adapters).
  const { status: googleStatus, errorReason: googleErrorReason, connect: connectGoogle } = useGoogleAuth();
  // Real Google Calendar events.
  const { events: googleEvents, connected: googleCalConnected, sync: syncGoogleCal } = useCalendarSync();
  // iCal feed events (multi-feed).
  const { events: icalEvents, connected: icalConnected, sync: syncICal } = useICalSync();
  // iCal feeds manager — add/remove feeds, re-sync on change.
  const { feeds: icalFeeds, saving: icalSaving, saveMsg: icalSaveMsg, addFeed: addICalFeed, removeFeed: removeICalFeed } = useICalFeeds(syncICal);
  // Merge and sort events from both calendar sources by start time.
  const calendarEvents    = [...googleEvents, ...icalEvents].sort((a, b) => a.start.localeCompare(b.start));
  const calendarConnected = googleCalConnected || icalConnected;
  const syncCalendar      = useCallback(() => { syncGoogleCal(); syncICal(); }, [syncGoogleCal, syncICal]);
  // Claude recommendations — auto-restored on mount, refreshable on demand.
  const {
    focus: claudeFocus, queue: claudeQueue, overdue: claudeOverdue,
    historyId: recoHistoryId, loading: recoLoading, restoring: recoRestoring,
    error: recoError, summary: recoSummary,
    cached: recoCached, cachedAt: recoCachedAt, stale: recoStale,
    emptyState: recoEmpty,
    dismissed: recoDismissed, dismiss: recoDissmiss, accept: recoAccept,
    ask: askClaude,
  } = useClaudeRecommendations();

  // Overdue items from Claude routed to the Alerts panel — dismissed locally only.
  const [dismissedOverdueKeys, setDismissedOverdueKeys] = useState(new Set());
  useEffect(() => { setDismissedOverdueKeys(new Set()); }, [recoHistoryId]);

  const overdueAlerts = (claudeOverdue ?? [])
    .filter(item => !dismissedOverdueKeys.has(item.beadsId ?? String(item.id)))
    .map(item => ({
      title:  `Overdue: ${item.title}`,
      body:   item.reason || null,
      source: 'overdue',
      _key:   item.beadsId ?? String(item.id),
    }));

  const dismissOverdue = useCallback((key) => {
    setDismissedOverdueKeys(prev => new Set([...prev, key]));
  }, []);

  // Run rules engine after world state finishes loading
  const handleRefresh = useCallback(async () => {
    await refreshWorld();
    evaluate();
  }, [refreshWorld, evaluate]);

  // Auto-evaluate on first world state load
  useEffect(() => {
    if (!worldLoading && !worldError) evaluate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldLoading]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Life Organizer</h1>
            <p className="text-xs text-gray-400 dark:text-gray-500">AI-powered task recommendations</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 dark:text-gray-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
            <DarkModeToggle mode={darkMode} setMode={setDarkMode} />
          </div>
        </div>

        {/* Stats — clickable filters across all sources */}
        <QuickStats tasks={[...tasks, ...beadsReady]} filter={filter} onFilterChange={setFilter} />

        {/* Two-column: Add Task + Calendar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Section title="Add Task" defaultOpen={true}>
            <TaskForm onAdd={addTask} />
          </Section>
          <Section title="Calendar" defaultOpen={true}>
            <CalendarContent
              events={calendarEvents}
              googleConnected={googleCalConnected}
              icalConnected={icalConnected}
              loading={googleCalConnected === null}
            />
          </Section>
        </div>

        {/* Conversation Intake — paste text, extract tasks and commitments */}
        <Section title="Capture" subtitle="paste text → extract tasks" defaultOpen={false}>
          <ConversationIntakeWidget />
        </Section>

        {/* Recommendations — Claude-powered portfolio: Focus Now + Up Next */}
        {(() => {
          const hasReco = claudeFocus != null || (claudeQueue?.length ?? 0) > 0;
          const recoCount = (claudeFocus ? 1 : 0) + (claudeQueue?.length ?? 0);
          const staleAge = recoCachedAt
            ? Math.round((Date.now() - new Date(recoCachedAt).getTime()) / (60 * 1000))
            : null;
          return (
            <Section
              title="Ask Claude"
              subtitle={hasReco ? 'AI recommendations' : 'on-demand recommendations'}
              badge={hasReco ? recoCount : undefined}
              defaultOpen={false}
            >
              {/* Focus card */}
              {hasReco && (
                <div className="mb-3">
                  <FocusCard
                    item={claudeFocus}
                    historyId={recoHistoryId}
                    dismissed={recoDismissed}
                    onDismiss={recoDissmiss}
                    onAccept={recoAccept}
                  />
                </div>
              )}

              {/* Up Next — queue */}
              {(claudeQueue?.length ?? 0) > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Up Next</p>
                  <div className="space-y-2">
                    {claudeQueue.map(item => (
                      <QueueCard
                        key={item.beadsId ?? item.id}
                        item={item}
                        historyId={recoHistoryId}
                        dismissed={recoDismissed}
                        onDismiss={recoDissmiss}
                        onAccept={recoAccept}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Summary line from Claude */}
              {recoSummary && (
                <p className="text-xs text-gray-500 dark:text-gray-400 italic mb-3">{recoSummary}</p>
              )}

              {/* Empty state */}
              {recoEmpty && !recoLoading && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                  No open tasks or unblocked Beads issues. Add a task or run <code className="font-mono">bd ready</code> to surface work.
                </p>
              )}

              {/* Prompt text — only show when not restoring and nothing loaded yet */}
              {!hasReco && !recoLoading && !recoRestoring && !recoError && !recoEmpty && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                  Claude will rank your open tasks and ready Beads issues by deadline, urgency, and calendar context.
                </p>
              )}

              {/* Error */}
              {recoError && (
                <p className="text-xs text-red-400 mb-2">{recoError}</p>
              )}

              {/* Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={askClaude}
                  disabled={recoLoading || recoRestoring}
                  className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {recoLoading ? 'Thinking…' : hasReco ? 'Refresh' : 'Ask Claude'}
                </button>
                {recoCachedAt && (
                  <span className="text-xs text-gray-300 dark:text-gray-600">
                    {recoCached && !recoStale ? `cached · ${new Date(recoCachedAt).toLocaleTimeString()}` : null}
                    {recoStale && staleAge !== null ? `from ${staleAge < 60 ? `${staleAge}m ago` : `${Math.round(staleAge / 60)}h ago`}` : null}
                  </span>
                )}
              </div>
            </Section>
          );
        })()}

        {/* Rules Engine notifications + Claude overdue items */}
        {(notifications.length > 0 || overdueAlerts.length > 0 || rulesError) && (
          <Section title="Alerts" badge={notifications.length + overdueAlerts.length} defaultOpen={false}>
            {rulesError && (
              <p className="text-xs text-red-400 mb-2">Rules engine error: {rulesError}</p>
            )}
            <div className="space-y-1.5">
              {overdueAlerts.map(item => (
                <div key={`overdue-${item._key}`} className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-900 dark:text-red-200">{item.title}</p>
                    {item.body && <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">{item.body}</p>}
                  </div>
                  <button
                    onClick={() => dismissOverdue(item._key)}
                    className="text-red-300 dark:text-red-700 hover:text-red-500 dark:hover:text-red-400 text-xs shrink-0 mt-0.5"
                  >✕</button>
                </div>
              ))}
              {notifications.map((n, i) => (
                <div key={i} className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{n.title}</p>
                    {n.body && <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">{n.body}</p>}
                  </div>
                  <button
                    onClick={() => dismiss(i)}
                    className="text-amber-300 dark:text-amber-600 hover:text-amber-500 dark:hover:text-amber-400 text-xs shrink-0 mt-0.5"
                  >✕</button>
                </div>
              ))}
            </div>
            {evaluatedAt && (
              <p className="text-xs text-gray-300 dark:text-gray-600 mt-2">
                evaluated {new Date(evaluatedAt).toLocaleTimeString()}
                {rulesLoading && ' · checking…'}
              </p>
            )}
          </Section>
        )}

        {/* Unified inbox — manual tasks (open_tasks) + Beads ready issues */}
        <UnifiedTaskList
          tasks={tasks}
          beadsReady={beadsReady}
          onStatusChange={updateStatus}
          onDelete={deleteTask}
          onSchedule={scheduleTask}
          filter={filter}
          onFilterChange={setFilter}
          worldError={worldError}
          worldLoading={worldLoading}
          beadsStale={beadsStale}
          syncedAt={syncedAt}
          onRefresh={handleRefresh}
        />

        {/* Settings — integrations */}
        <Section title="Settings" defaultOpen={false}>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Google Calendar + Gmail</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                Grants read-only access to Calendar events and Gmail messages for the AI context collector.
              </p>
              {googleStatus === 'connected' ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                    Google Connected
                  </span>
                  <button
                    onClick={connectGoogle}
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline underline-offset-2"
                    title="Re-authorize to update permissions"
                  >re-authorize</button>
                </div>
              ) : (
                <div className="space-y-1">
                  <button
                    onClick={connectGoogle}
                    disabled={!import.meta.env.VITE_GOOGLE_CLIENT_ID || googleStatus === 'unknown'}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {googleStatus === 'unknown' ? 'Checking…' : 'Connect Google'}
                  </button>
                  {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">VITE_GOOGLE_CLIENT_ID not configured</p>
                  )}
                  {googleStatus === 'error' && (
                    <p className="text-xs text-red-500">Connection failed{googleErrorReason ? ` (${googleErrorReason})` : ''} — please try again</p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Calendar Feeds</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                Add any number of iCal feeds (<code className="text-gray-500 dark:text-gray-400">webcal://</code> or <code className="text-gray-500 dark:text-gray-400">https://</code>). Works with iCloud, Outlook, Fantastical, and any CalDAV app.
              </p>
              <ICalFeedsManager
                feeds={icalFeeds}
                saving={icalSaving}
                saveMsg={icalSaveMsg}
                onAdd={addICalFeed}
                onRemove={removeICalFeed}
              />
            </div>
          </div>
        </Section>

        <p className="text-xs text-center text-gray-300 dark:text-gray-600">Tasks · Beads · Calendar</p>
      </div>
    </div>
  );
}
