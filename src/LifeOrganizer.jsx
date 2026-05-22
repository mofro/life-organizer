import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWorldState } from './useWorldState.js';
import { useRulesEngine } from './useRulesEngine.js';

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
      setEvents(data.events ?? []);
      if (data.synced_at) setSyncedAt(data.synced_at);
    } catch {
      setConnected(false);
      setEvents([]);
    }
  }, []);

  useEffect(() => { sync(); }, [sync]);

  return { events, connected, syncedAt, sync };
}

// ─── Recommendation engine ───────────────────────────────────────────────────
function getRecommendations(tasks, calendar) {
  const pending = tasks.filter(t => t.status === 'pending');
  if (pending.length === 0) return [];

  const now = new Date();
  const focusToday = calendar.filter(e => e.date === 'today' && e.type === 'focus');

  const scored = pending.map(task => {
    let score = 0;
    let reasons = [];

    if (task.deadline) {
      const daysUntil = (new Date(task.deadline) - now) / (1000 * 60 * 60 * 24);
      if (daysUntil < 1) { score += 100; reasons.push('due today'); }
      else if (daysUntil < 3) { score += 60; reasons.push('due soon'); }
      else if (daysUntil < 7) { score += 30; reasons.push('due this week'); }
    }

    const priorityBoost = { high: 40, medium: 20, low: 5 };
    score += priorityBoost[task.priority] || 0;

    if (task.timeRequired && task.timeRequired <= 60) {
      score += 25;
      reasons.push('quick win');
    }

    if (task.timeRequired && task.timeRequired >= 180 && focusToday.length > 0) {
      score += 20;
      reasons.push('fits focus block');
    }

    return { ...task, score, reason: reasons.join(' · ') || task.priority + ' priority' };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ─── Storage helpers ─────────────────────────────────────────────────────────
async function storageSave(key, value) {
  try {
    if (window.storage?.set) await window.storage.set(key, JSON.stringify(value));
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

async function storageLoad(key) {
  try {
    if (window.storage?.get) {
      const result = await window.storage.get(key);
      return result?.value ? JSON.parse(result.value) : null;
    }
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch { return null; }
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
function QuickStats({ tasks, filter, onFilterChange }) {
  const counts = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  const overdue = tasks.filter(t => t.deadline && new Date(t.deadline) < new Date() && t.status === 'pending').length;

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

// ─── Calendar section ─────────────────────────────────────────────────────────
function CalendarContent({ events, connected }) {
  const typeStyle = { meeting: 'bg-blue-100 text-blue-700', focus: 'bg-purple-100 text-purple-700' };

  // Still loading (connected === null)
  if (connected === null) {
    return <p className="text-xs text-gray-300 pt-1">Loading calendar…</p>;
  }

  // Google not connected — prompt user to connect
  if (!connected) {
    return (
      <p className="text-xs text-gray-400 pt-1">
        Connect Google in <span className="font-medium">Settings</span> to see your real calendar.
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
                  <span className="text-xs text-gray-400 w-20 shrink-0">{ev.start}–{ev.end}</span>
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
function TaskRow({ task, onStatusChange, onDelete }) {
  const statusColor = { pending: 'text-gray-400', in_progress: 'text-yellow-500', completed: 'text-green-500' };
  const priorityBadge = { high: 'bg-red-100 text-red-700', medium: 'bg-yellow-100 text-yellow-700', low: 'bg-gray-100 text-gray-600' };
  const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'completed';

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
        </div>
      </div>
      <button onClick={() => onDelete(task.id)} className="text-gray-300 hover:text-red-400 text-xs shrink-0 mt-0.5">✕</button>
    </div>
  );
}

// ─── Task list ────────────────────────────────────────────────────────────────
function TaskList({ tasks, onStatusChange, onDelete, filter, onFilterChange }) {
  const filtered = tasks.filter(t => {
    if (filter === 'pending')     return t.status === 'pending';
    if (filter === 'in_progress') return t.status === 'in_progress';
    if (filter === 'completed')   return t.status === 'completed';
    if (filter === 'overdue')     return t.deadline && new Date(t.deadline) < new Date() && t.status === 'pending';
    if (filter === 'active')      return t.status !== 'completed';
    return true;
  });

  const filterLabel = {
    all: 'All', active: 'Active', pending: 'Pending',
    in_progress: 'Doing', completed: 'Done', overdue: 'Overdue',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          Tasks
          {filter !== 'all' && <span className="ml-1.5 text-xs font-normal text-blue-600">· {filterLabel[filter]}</span>}
          <span className="ml-1.5 text-xs font-normal text-gray-400">({filtered.length})</span>
        </h3>
        <div className="flex gap-1">
          {['all', 'active'].map(f => (
            <button
              key={f}
              onClick={() => onFilterChange(f)}
              className={`text-xs px-2 py-1 rounded capitalize ${filter === f ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">
          {filter === 'all' ? 'No tasks yet — add one above' : `No ${filterLabel[filter]?.toLowerCase()} tasks`}
        </p>
      ) : (
        filtered.map(task => (
          <TaskRow key={task.id} task={task} onStatusChange={onStatusChange} onDelete={onDelete} />
        ))
      )}
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
      'https://www.googleapis.com/auth/calendar.readonly',
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
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('active');
  const [loaded, setLoaded] = useState(false);

  // World State: reads from Supabase (via Netlify function) — source of truth in production.
  const { beadsReady, derived, syncedAt, beadsError: beadsStale, loading: worldLoading, error: worldError, refresh: refreshWorld } = useWorldState();
  // Rules Engine: evaluates World State after each sync, returns fired notifications.
  const { notifications, evaluatedAt, loading: rulesLoading, error: rulesError, evaluate, dismiss } = useRulesEngine();
  // Google OAuth connection state (for Calendar + Gmail adapters).
  const { status: googleStatus, errorReason: googleErrorReason, connect: connectGoogle } = useGoogleAuth();
  // Real Google Calendar events — replaces MOCK_CALENDAR.
  const { events: calendarEvents, connected: calendarConnected, sync: syncCalendar } = useCalendarSync();
  useEffect(() => {
    storageLoad('lo-tasks').then(saved => {
      if (saved) setTasks(saved);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) storageSave('lo-tasks', tasks);
  }, [tasks, loaded]);

  const addTask      = useCallback((task) => setTasks(prev => [task, ...prev]), []);
  const updateStatus = useCallback((id, status) => setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t)), []);
  const deleteTask   = useCallback((id) => setTasks(prev => prev.filter(t => t.id !== id)), []);
  const completeTask = useCallback((id) => setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'completed' } : t)), []);

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

  // Recommendations draw from both manual tasks and ready Beads tasks
  const allTasksForReco = [...tasks, ...beadsReady];
  const recommendations = getRecommendations(allTasksForReco, calendarEvents);

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

        {/* Stats — clickable filters (manual tasks only for now) */}
        <QuickStats tasks={tasks} filter={filter} onFilterChange={setFilter} />

        {/* Recommendations — across all sources */}
        {recommendations.length > 0 && (
          <Section title="Recommended now" subtitle="based on deadlines & available time" badge={recommendations.length}>
            <div className="space-y-2">
              {recommendations.map(task => (
                <RecommendationCard key={task.id} task={task} onComplete={completeTask} />
              ))}
            </div>
          </Section>
        )}

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

        {/* Beads — ready issues from World State */}
        <Section
          title="Beads — ready to work"
          subtitle={beadsStale ? '⚠ stale data' : syncedAt ? `synced ${new Date(syncedAt).toLocaleTimeString()}` : undefined}
          badge={beadsReady.length}
          defaultOpen={false}
        >
          {worldError ? (
            <div className="text-xs text-red-400 py-2">
              <p>World State sync failed: {worldError}</p>
            </div>
          ) : worldLoading ? (
            <p className="text-xs text-gray-400 py-2">Syncing…</p>
          ) : beadsReady.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No unblocked issues.</p>
          ) : (
            <div>
              {beadsStale && (
                <p className="text-xs text-amber-500 mb-2">Beads Service unreachable — showing last known data.</p>
              )}
              {beadsReady.map(task => (
                <BeadsTaskRow
                  key={task.id}
                  task={task}
                />
              ))}
              <button
                onClick={handleRefresh}
                className="mt-2 text-xs text-gray-400 hover:text-gray-600"
              >↺ refresh</button>
            </div>
          )}
        </Section>

        {/* Two-column: Add Task + Calendar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Section title="Add Task" defaultOpen={true}>
            <TaskForm onAdd={addTask} />
          </Section>
          <Section title="Calendar" defaultOpen={true}>
            <CalendarContent events={calendarEvents} connected={calendarConnected} />
          </Section>
        </div>

        {/* Manual task list */}
        <TaskList
          tasks={tasks}
          onStatusChange={updateStatus}
          onDelete={deleteTask}
          filter={filter}
          onFilterChange={setFilter}
        />

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
          </div>
        </Section>

        <p className="text-xs text-center text-gray-300">Tasks saved locally · Phase 2</p>
      </div>
    </div>
  );
}
