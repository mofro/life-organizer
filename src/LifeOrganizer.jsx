import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWorldState } from './useWorldState.js';
import { useRulesEngine } from './useRulesEngine.js';

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

// ─── iCal URL persistence hook ───────────────────────────────────────────────
// Loads/saves the iCal feed URL via ical-save-url.
function useICalUrl() {
  const [url, setUrl]         = useState('');
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState(null); // null | 'saved' | 'error'

  // Load current URL from the sync function on mount (connected=true means URL is set)
  useEffect(() => {
    fetch('/.netlify/functions/ical-sync')
      .then(r => r.json())
      .then(d => { if (d.connected) setUrl('(configured — paste a new URL to update)'); })
      .catch(() => {});
  }, []);

  const save = useCallback(async (newUrl) => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res  = await fetch('/.netlify/functions/ical-save-url', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: newUrl }),
      });
      const data = await res.json();
      setSaveMsg(data.ok ? 'saved' : 'error');
      if (data.ok) setUrl(newUrl ? '(configured — paste a new URL to update)' : '');
    } catch {
      setSaveMsg('error');
    } finally {
      setSaving(false);
    }
  }, []);

  return { url, saving, saveMsg, save };
}

// ─── Claude recommendations hook ─────────────────────────────────────────────
// Calls /.netlify/functions/recommend to get AI-ranked task recommendations.
// Results are cached server-side for 30 min when the world state hasn't changed.
function useClaudeRecommendations() {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState(null);
  const [summary, setSummary]                 = useState(null);
  const [cached, setCached]                   = useState(false);
  const [cachedAt, setCachedAt]               = useState(null);
  const [emptyState, setEmptyState]           = useState(false);

  const ask = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmptyState(false);
    try {
      const res  = await fetch('/.netlify/functions/recommend', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRecommendations(data.recommendations || []);
      setSummary(data.summary   || null);
      setCached(data.cached     || false);
      setCachedAt(data.cachedAt || null);
      setEmptyState(data.emptyState || false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { recommendations, loading, error, summary, cached, cachedAt, emptyState, ask };
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

// ─── Collapsible section wrapper ─────────────────────────────────────────────
function Section({ title, subtitle, defaultOpen = true, children, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">{title}</span>
          {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
          {badge != null && badge > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-medium">{badge}</span>
          )}
        </div>
        <span className={`text-gray-400 text-xs transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ─── Source badge ─────────────────────────────────────────────────────────────
const SOURCE_STYLE = {
  manual:   { label: 'manual',   cls: 'bg-gray-100 text-gray-500' },
  beads:    { label: 'beads',    cls: 'bg-indigo-100 text-indigo-700' },
  email:    { label: 'email',    cls: 'bg-sky-100 text-sky-700' },
  calendar: { label: 'calendar', cls: 'bg-purple-100 text-purple-700' },
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
            className={`bg-white rounded-lg border p-3 text-center transition-all cursor-pointer hover:shadow-sm
              ${active ? `border-transparent ring-2 ${ring}` : 'border-gray-200 hover:border-gray-300'}`}
          >
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </button>
        );
      })}
    </div>
  );
}

// ─── Recommendation card ──────────────────────────────────────────────────────
function RecommendationCard({ task, onComplete }) {
  const priorityColor = { high: 'bg-red-50 border-red-200', medium: 'bg-yellow-50 border-yellow-200', low: 'bg-green-50 border-green-200' };
  return (
    <div className={`border rounded-lg p-3 flex items-start gap-3 ${priorityColor[task.priority] || 'bg-gray-50 border-gray-200'}`}>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm truncate">{task.title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{task.reason}</p>
        <div className="flex gap-2 mt-1 flex-wrap">
          {task.timeRequired && (
            <span className="text-xs text-gray-400">{task.timeRequired >= 60 ? `${Math.round(task.timeRequired / 60)}h` : `${task.timeRequired}m`}</span>
          )}
          {task.deadline && (
            <span className="text-xs text-gray-400">due {new Date(task.deadline).toLocaleDateString()}</span>
          )}
          <SourceBadge source={task.source} sourceUrl={task.sourceUrl} />
        </div>
      </div>
      {task.source === 'beads' ? (
        <span className="text-xs text-gray-300 shrink-0 pt-0.5">bd close {task.beadsId}</span>
      ) : (
        <button
          onClick={() => onComplete(task.id)}
          className="text-xs bg-white border border-gray-300 rounded px-2 py-1 hover:bg-gray-50 shrink-0"
        >
          Done
        </button>
      )}
    </div>
  );
}

// ─── iCal URL input form ──────────────────────────────────────────────────────
function ICalUrlForm({ currentUrl, saving, saveMsg, onSave, onSynced }) {
  const [input, setInput] = useState('');

  const handleSave = async () => {
    await onSave(input.trim());
    setInput('');
    if (input.trim()) onSynced(); // refresh events after saving a new URL
  };

  return (
    <div className="space-y-1.5">
      {currentUrl && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block"></span>
          iCal connected
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="url"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={currentUrl ? 'Paste new URL to update…' : 'Paste iCal URL (webcal:// or https://)'}
          className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder-gray-300"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {currentUrl && (
          <button
            onClick={() => onSave('')}
            disabled={saving}
            className="text-xs text-gray-400 hover:text-red-500 underline underline-offset-2 disabled:opacity-40"
          >
            Remove
          </button>
        )}
      </div>
      {saveMsg === 'saved' && <p className="text-xs text-green-600">Saved — syncing…</p>}
      {saveMsg === 'error' && <p className="text-xs text-red-500">Save failed — check the URL and try again</p>}
    </div>
  );
}

function localTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── Calendar section ─────────────────────────────────────────────────────────
function CalendarContent({ events, googleConnected, icalConnected, loading }) {
  const typeStyle = { meeting: 'bg-blue-100 text-blue-700', focus: 'bg-purple-100 text-purple-700' };
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
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1.5">{label}</p>
            <div className="space-y-1">
              {evs.map(ev => (
                <div key={ev.id} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-20 shrink-0">
                    {localTime(ev.startISO) ?? ev.start}–{localTime(ev.endISO) ?? ev.end}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeStyle[ev.type] || 'bg-gray-100 text-gray-600'}`}>{ev.title}</span>
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
        className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoComplete="off"
      />
      <div className="grid grid-cols-2 gap-2">
        <select name="category" className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="general">General</option>
          <option value="work">Work</option>
          <option value="personal">Personal</option>
          <option value="health">Health</option>
          <option value="learning">Learning</option>
        </select>
        <select name="priority" className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
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
          className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          name="deadline"
          type="date"
          className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
  const priorityBadge = { high: 'bg-red-100 text-red-700', medium: 'bg-yellow-100 text-yellow-700', low: 'bg-gray-100 text-gray-600' };
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
    <div className={`flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0 ${task.status === 'completed' ? 'opacity-50' : ''}`}>
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
        <p className={`text-sm ${task.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.title}</p>
        <div className="flex flex-wrap gap-1.5 mt-1">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityBadge[task.priority]}`}>{task.priority}</span>
          <span className="text-xs text-gray-400">{task.category}</span>
          {task.timeRequired && <span className="text-xs text-gray-400">{task.timeRequired >= 60 ? `${Math.round(task.timeRequired / 60)}h` : `${task.timeRequired}m`}</span>}
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
                    className="text-xs text-gray-300 hover:text-purple-500 disabled:opacity-40 transition-colors"
                    title="Schedule as calendar event"
                  >{scheduling ? '…' : '📅'}</button>
          )}
        </div>
      </div>
      <button onClick={() => onDelete(task.id)} className="text-gray-300 hover:text-red-400 text-xs shrink-0 mt-0.5">✕</button>
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
  const [tab, setTab] = useState('beads'); // 'manual' | 'beads' | 'all'
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
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-gray-100">
        {TABS.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
              ${tab === key
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
          >
            {label}
            {count > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none
                ${tab === key ? 'bg-blue-200 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                {count}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {syncLabel && (
            <span className={`text-xs ${beadsStale ? 'text-amber-500' : 'text-gray-300'}`}>{syncLabel}</span>
          )}
          {onRefresh && (
            <button onClick={onRefresh} className="text-xs text-gray-300 hover:text-gray-500" title="Refresh">↺</button>
          )}
        </div>
      </div>

      <div className="p-4">
        {/* Active filter chip */}
        {filter !== 'active' && filter !== 'all' && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-2 py-0.5">
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
          const { groups, standalone } = groupByFeature(beadsReady);
          if (groups.length === 0 && standalone.length === 0) {
            return <p className="text-sm text-gray-400 text-center py-6">{EMPTY.hierarchy}</p>;
          }
          return (
            <div>
              {groups.map(({ featureId, featureTitle, featurePriority, tasks }) => (
                <div key={featureId} className="mb-4">
                  <div className="flex items-center gap-2 px-1 py-1.5 mb-1 border-b border-gray-100">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Feature</span>
                    <span className="text-sm font-medium text-gray-700 flex-1">{featureTitle}</span>
                    {featurePriority !== null && (
                      <span className="text-xs bg-gray-100 text-gray-500 rounded px-1.5 py-0.5 font-mono">P{featurePriority}</span>
                    )}
                  </div>
                  <div className="pl-3">
                    {tasks.map(task => <BeadsTaskRow key={task.id} task={task} />)}
                  </div>
                </div>
              ))}
              {standalone.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 px-1 py-1.5 mb-1 border-b border-gray-100">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Standalone Tasks</span>
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
      className="flex items-center gap-1.5 text-xs font-mono bg-gray-50 border border-gray-200 text-gray-500 rounded px-2 py-1 hover:bg-gray-100 hover:text-gray-700 transition-colors"
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

  const priorityBadge = { high: 'bg-red-100 text-red-700', medium: 'bg-yellow-100 text-yellow-700', low: 'bg-gray-100 text-gray-600' };

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* Summary row — click to expand */}
      <button
        onClick={toggle}
        className="w-full flex items-start gap-3 py-2.5 text-left hover:bg-gray-50 rounded transition-colors"
      >
        <span className={`text-xs mt-0.5 transition-transform duration-150 text-indigo-300 ${open ? 'rotate-90' : ''}`}>▶</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm text-gray-800 truncate">{task.title}</p>
            <span className="text-xs text-gray-300 shrink-0">{task.beadsId}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityBadge[task.priority]}`}>{task.priority}</span>
            {task.status === 'in_progress' && (
              <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700">▶ active</span>
            )}
            {task.issueType && task.issueType !== 'task' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{task.issueType}</span>
            )}
            {task.project && <span className="text-xs text-gray-400">{task.project}</span>}
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
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  );
}

function ExternalRef({ value, description }) {
  // Try to pull a full URL from the description first (e.g. "Tracks https://github.com/...")
  const urlMatch = description?.match(/https?:\/\/[^\s)]+/);
  const url = urlMatch?.[0] ?? null;

  return (
    <div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">External ref</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer"
          className="text-xs text-sky-600 hover:underline break-all"
        >{value} ↗</a>
      ) : (
        <span className="text-xs text-gray-600">{value}</span>
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
  // Apple iCal feed events.
  const { events: icalEvents, connected: icalConnected, sync: syncICal } = useICalSync();
  // iCal URL persistence.
  const { url: icalUrl, saving: icalSaving, saveMsg: icalSaveMsg, save: saveICalUrl } = useICalUrl();
  // Merge and sort events from both calendar sources by start time.
  const calendarEvents    = [...googleEvents, ...icalEvents].sort((a, b) => a.start.localeCompare(b.start));
  const calendarConnected = googleCalConnected || icalConnected;
  const syncCalendar      = useCallback(() => { syncGoogleCal(); syncICal(); }, [syncGoogleCal, syncICal]);
  // Claude recommendations — on-demand, replaces local scoring algorithm.
  const { recommendations: claudeRecs, loading: recoLoading, error: recoError, summary: recoSummary, cached: recoCached, cachedAt: recoCachedAt, emptyState: recoEmpty, ask: askClaude } = useClaudeRecommendations();

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
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Life Organizer</h1>
            <p className="text-xs text-gray-400">AI-powered task recommendations</p>
          </div>
          <div className="text-xs text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        </div>

        {/* Stats — clickable filters across all sources */}
        <QuickStats tasks={[...tasks, ...beadsReady]} filter={filter} onFilterChange={setFilter} />

        {/* Recommendations — Claude-powered, on-demand */}
        <Section
          title="Ask Claude"
          subtitle={claudeRecs.length > 0 ? 'AI recommendations' : 'on-demand recommendations'}
          badge={claudeRecs.length > 0 ? claudeRecs.length : undefined}
          defaultOpen={claudeRecs.length > 0 || recoLoading || !!recoError}
        >
          {/* Results */}
          {claudeRecs.length > 0 && (
            <div className="space-y-2 mb-3">
              {claudeRecs.map(task => (
                <RecommendationCard key={task.beadsId ?? task.id} task={task} onComplete={completeTask} />
              ))}
            </div>
          )}

          {/* Summary line from Claude */}
          {recoSummary && (
            <p className="text-xs text-gray-500 italic mb-3">{recoSummary}</p>
          )}

          {/* Empty state */}
          {recoEmpty && !recoLoading && (
            <p className="text-xs text-gray-400 mb-3">
              No open tasks or unblocked Beads issues. Add a task or run <code className="font-mono">bd ready</code> to surface work.
            </p>
          )}

          {/* Prompt text before first ask */}
          {claudeRecs.length === 0 && !recoLoading && !recoError && !recoEmpty && (
            <p className="text-xs text-gray-400 mb-3">
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
              disabled={recoLoading}
              className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {recoLoading ? 'Thinking…' : claudeRecs.length > 0 ? 'Refresh' : 'Ask Claude'}
            </button>
            {recoCached && recoCachedAt && (
              <span className="text-xs text-gray-300">
                cached · {new Date(recoCachedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </Section>

        {/* Rules Engine notifications */}
        {(notifications.length > 0 || rulesError) && (
          <Section title="Alerts" badge={notifications.length} defaultOpen={true}>
            {rulesError && (
              <p className="text-xs text-red-400 mb-2">Rules engine error: {rulesError}</p>
            )}
            <div className="space-y-1.5">
              {notifications.map((n, i) => (
                <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-900">{n.title}</p>
                    {n.body && <p className="text-xs text-amber-700 mt-0.5">{n.body}</p>}
                  </div>
                  <button
                    onClick={() => dismiss(i)}
                    className="text-amber-300 hover:text-amber-500 text-xs shrink-0 mt-0.5"
                  >✕</button>
                </div>
              ))}
            </div>
            {evaluatedAt && (
              <p className="text-xs text-gray-300 mt-2">
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

        {/* Settings — integrations */}
        <Section title="Settings" defaultOpen={false}>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-700 mb-1">Google Calendar + Gmail</p>
              <p className="text-xs text-gray-400 mb-2">
                Grants read-only access to Calendar events and Gmail messages for the AI context collector.
              </p>
              {googleStatus === 'connected' ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                    Google Connected
                  </span>
                  <button
                    onClick={connectGoogle}
                    className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
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
                    <p className="text-xs text-amber-600">VITE_GOOGLE_CLIENT_ID not configured</p>
                  )}
                  {googleStatus === 'error' && (
                    <p className="text-xs text-red-500">Connection failed{googleErrorReason ? ` (${googleErrorReason})` : ''} — please try again</p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-700 mb-1">Apple Calendar / iCal Feed</p>
              <p className="text-xs text-gray-400 mb-2">
                Paste a calendar share URL (<code className="text-gray-500">webcal://</code> or <code className="text-gray-500">https://</code>). Works with iCloud, Fantastical, Outlook, and any CalDAV app.
              </p>
              <ICalUrlForm
                currentUrl={icalUrl}
                saving={icalSaving}
                saveMsg={icalSaveMsg}
                onSave={saveICalUrl}
                onSynced={syncICal}
              />
            </div>
          </div>
        </Section>

        <p className="text-xs text-center text-gray-300">Tasks · Beads · Calendar</p>
      </div>
    </div>
  );
}
