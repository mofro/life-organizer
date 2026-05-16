import React, { useState, useRef, useEffect, useCallback } from 'react';

// ─── Mock calendar events ────────────────────────────────────────────────────
const MOCK_CALENDAR = [
  { id: 1, title: 'Team standup', start: '09:00', end: '09:30', date: 'today', type: 'meeting' },
  { id: 2, title: 'Deep work block', start: '10:00', end: '12:00', date: 'today', type: 'focus' },
  { id: 3, title: '1:1 with manager', start: '14:00', end: '14:30', date: 'today', type: 'meeting' },
  { id: 4, title: 'Product review', start: '11:00', end: '12:00', date: 'tomorrow', type: 'meeting' },
  { id: 5, title: 'Sprint planning', start: '13:00', end: '15:00', date: 'tomorrow', type: 'meeting' },
];

// ─── Recommendation engine ───────────────────────────────────────────────────
function getRecommendations(tasks, calendar) {
  const pending = tasks.filter(t => t.status === 'pending');
  if (pending.length === 0) return [];

  const now = new Date();
  const scored = pending.map(task => {
    let score = 0;
    let reasons = [];

    // Deadline urgency
    if (task.deadline) {
      const daysUntil = (new Date(task.deadline) - now) / (1000 * 60 * 60 * 24);
      if (daysUntil < 1) { score += 100; reasons.push('due today'); }
      else if (daysUntil < 3) { score += 60; reasons.push('due soon'); }
      else if (daysUntil < 7) { score += 30; reasons.push('due this week'); }
    }

    // Priority boost
    const priorityBoost = { high: 40, medium: 20, low: 5 };
    score += priorityBoost[task.priority] || 0;

    // Quick win: under 1 hour
    if (task.timeRequired && task.timeRequired <= 60) {
      score += 25;
      reasons.push('quick win');
    }

    // Big block: 3+ hours (good for focus time)
    const focusToday = calendar.filter(e => e.date === 'today' && e.type === 'focus');
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
    if (window.storage?.set) {
      await window.storage.set(key, JSON.stringify(value));
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {}
}

async function storageLoad(key) {
  try {
    if (window.storage?.get) {
      const result = await window.storage.get(key);
      return result?.value ? JSON.parse(result.value) : null;
    } else {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    }
  } catch {
    return null;
  }
}

// ─── Components ──────────────────────────────────────────────────────────────

function RecommendationCard({ task, onComplete }) {
  const priorityColor = { high: 'bg-red-50 border-red-200', medium: 'bg-yellow-50 border-yellow-200', low: 'bg-green-50 border-green-200' };
  return (
    <div className={`border rounded-lg p-3 flex items-start gap-3 ${priorityColor[task.priority] || 'bg-gray-50 border-gray-200'}`}>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm truncate">{task.title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{task.reason}</p>
        <div className="flex gap-2 mt-1">
          {task.timeRequired && (
            <span className="text-xs text-gray-400">{task.timeRequired >= 60 ? `${Math.round(task.timeRequired / 60)}h` : `${task.timeRequired}m`}</span>
          )}
          {task.deadline && (
            <span className="text-xs text-gray-400">due {new Date(task.deadline).toLocaleDateString()}</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onComplete(task.id)}
        className="text-xs bg-white border border-gray-300 rounded px-2 py-1 hover:bg-gray-50 shrink-0"
      >
        Done
      </button>
    </div>
  );
}

function QuickStats({ tasks }) {
  const counts = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  const overdue = tasks.filter(t => t.deadline && new Date(t.deadline) < new Date() && t.status === 'pending').length;

  return (
    <div className="grid grid-cols-4 gap-3">
      {[
        { label: 'Pending', value: counts.pending || 0, color: 'text-blue-600' },
        { label: 'In Progress', value: counts.in_progress || 0, color: 'text-yellow-600' },
        { label: 'Done', value: counts.completed || 0, color: 'text-green-600' },
        { label: 'Overdue', value: overdue, color: 'text-red-600' },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-gray-500 mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  );
}

function CalendarSection({ events }) {
  const typeStyle = { meeting: 'bg-blue-100 text-blue-700', focus: 'bg-purple-100 text-purple-700' };
  const todayEvents = events.filter(e => e.date === 'today');
  const tomorrowEvents = events.filter(e => e.date === 'tomorrow');

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Calendar</h3>
      <div className="space-y-3">
        {[['Today', todayEvents], ['Tomorrow', tomorrowEvents]].map(([label, evs]) => (
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
        ))}
      </div>
    </div>
  );
}

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
      createdAt: new Date().toISOString(),
    });

    formRef.current.reset();
  }, [onAdd]);

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Add Task</h3>
      <div className="space-y-2">
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
      </div>
    </form>
  );
}

function TaskRow({ task, onStatusChange, onDelete }) {
  const statusColor = { pending: 'text-gray-400', in_progress: 'text-yellow-500', completed: 'text-green-500' };
  const priorityBadge = { high: 'bg-red-100 text-red-700', medium: 'bg-yellow-100 text-yellow-700', low: 'bg-gray-100 text-gray-600' };
  const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'completed';

  return (
    <div className={`flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0 ${task.status === 'completed' ? 'opacity-50' : ''}`}>
      <select
        value={task.status}
        onChange={e => onStatusChange(task.id, e.target.value)}
        className={`text-xs border-0 bg-transparent cursor-pointer focus:outline-none ${statusColor[task.status]}`}
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
        </div>
      </div>
      <button onClick={() => onDelete(task.id)} className="text-gray-300 hover:text-red-400 text-xs shrink-0">✕</button>
    </div>
  );
}

function TaskList({ tasks, onStatusChange, onDelete, filter, onFilterChange }) {
  const filtered = tasks.filter(t => {
    if (filter === 'active') return t.status !== 'completed';
    if (filter === 'completed') return t.status === 'completed';
    return true;
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Tasks ({filtered.length})</h3>
        <div className="flex gap-1">
          {['all', 'active', 'completed'].map(f => (
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
        <p className="text-sm text-gray-400 text-center py-4">No tasks yet — add one above</p>
      ) : (
        filtered.map(task => (
          <TaskRow key={task.id} task={task} onStatusChange={onStatusChange} onDelete={onDelete} />
        ))
      )}
    </div>
  );
}

// ─── Main app ─────────────────────────────────────────────────────────────────
export default function LifeOrganizer() {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('active');
  const [loaded, setLoaded] = useState(false);

  // Load persisted tasks on mount
  useEffect(() => {
    storageLoad('lo-tasks').then(saved => {
      if (saved) setTasks(saved);
      setLoaded(true);
    });
  }, []);

  // Persist on every change (after initial load)
  useEffect(() => {
    if (loaded) storageSave('lo-tasks', tasks);
  }, [tasks, loaded]);

  const addTask = useCallback((task) => {
    setTasks(prev => [task, ...prev]);
  }, []);

  const updateStatus = useCallback((id, status) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  }, []);

  const deleteTask = useCallback((id) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  const completeTask = useCallback((id) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'completed' } : t));
  }, []);

  const recommendations = getRecommendations(tasks, MOCK_CALENDAR);

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

        {/* Stats */}
        <QuickStats tasks={tasks} />

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Recommended now
              <span className="ml-2 text-xs font-normal text-gray-400">based on deadlines & available time</span>
            </h3>
            <div className="space-y-2">
              {recommendations.map(task => (
                <RecommendationCard key={task.id} task={task} onComplete={completeTask} />
              ))}
            </div>
          </div>
        )}

        {/* Two column: form + calendar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TaskForm onAdd={addTask} />
          <CalendarSection events={MOCK_CALENDAR} />
        </div>

        {/* Task list */}
        <TaskList
          tasks={tasks}
          onStatusChange={updateStatus}
          onDelete={deleteTask}
          filter={filter}
          onFilterChange={setFilter}
        />

        <p className="text-xs text-center text-gray-300">Tasks saved locally · Phase 1 MVP</p>
      </div>
    </div>
  );
}
