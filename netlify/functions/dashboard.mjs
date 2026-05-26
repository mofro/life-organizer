// dashboard — Netlify Function
// Serves the beads-global dashboard SPA at /dashboard.
// Injects SUPABASE_URL and SUPABASE_ANON_KEY at serve time.
// Auth: Supabase magic link. All data API calls proxy to DoltHub server-side.

const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env;

const HTML = (supabaseUrl, supabaseAnonKey) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>bdg dashboard</title>
<style>
  :root {
    --bg: #0d1117; --fg: #c9d1d9; --muted: #8b949e; --border: #30363d;
    --accent: #58a6ff; --row-hover: #161b22; --panel: #161b22;
    --row-border: #20262d;
    --p0: #f85149; --p1: #ff8c42; --p2: #58a6ff; --p3: #8b949e; --p4: #6e7681;
  }
  :root[data-theme="light"] {
    --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de;
    --accent: #0969da; --row-hover: #f6f8fa; --panel: #f6f8fa;
    --row-border: #eaeef2;
    --p0: #cf222e; --p1: #bc4c00; --p2: #0969da; --p3: #656d76; --p4: #8c959f;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme]) {
      --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de;
      --accent: #0969da; --row-hover: #f6f8fa; --panel: #f6f8fa;
      --row-border: #eaeef2;
      --p0: #cf222e; --p1: #bc4c00; --p2: #0969da; --p3: #656d76; --p4: #8c959f;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); font-size: 14px; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

  /* Auth overlay */
  #auth-overlay { position: fixed; inset: 0; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 100; }
  #auth-overlay.hidden { display: none; }
  .auth-box { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 32px 40px; width: 360px; text-align: center; }
  .auth-box h2 { margin: 0 0 6px; font-size: 18px; color: var(--fg); }
  .auth-box p { margin: 0 0 20px; color: var(--muted); font-size: 13px; }
  .auth-box input { width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); font-size: 14px; font-family: inherit; margin-bottom: 10px; }
  .auth-box button { width: 100%; padding: 9px; background: var(--accent); color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .auth-box button:disabled { opacity: 0.6; cursor: default; }
  .auth-msg { margin-top: 12px; font-size: 13px; color: var(--muted); min-height: 18px; }
  .auth-msg.error { color: var(--p0); }

  header { display: flex; flex-direction: column; gap: 6px; padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--panel); z-index: 10; flex-shrink: 0; }
  .header-main { display: flex; align-items: center; gap: 10px; }
  .header-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  header h1 { margin: 0; font-size: 14px; font-weight: 600; color: var(--accent); white-space: nowrap; }
  header input, header select, header button { background: var(--bg); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 6px; font-size: 13px; font-family: inherit; }
  header input { flex: 1; min-width: 160px; }
  header button { cursor: pointer; }
  header button:hover { border-color: var(--accent); }
  .meta-info { color: var(--muted); font-size: 12px; margin-left: auto; }
  .view-legend { font-size: 11px; color: var(--muted); white-space: nowrap; margin-left: auto; }

  main { flex: 1; min-height: 0; display: flex; }
  .list { flex: 1; overflow-y: auto; }
  .detail { width: 0; min-width: 0; border-left: 0 solid var(--border); overflow: hidden; background: var(--panel); padding: 0; transition: width 0.15s, padding 0.15s, border-left-width 0.15s; }
  body.detail-open .detail { width: 480px; min-width: 360px; border-left-width: 1px; padding: 14px 18px 18px; overflow-y: auto; }
  .detail-header { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
  .detail-header h2 { flex: 1; margin: 0; font-size: 16px; line-height: 1.35; word-wrap: break-word; }
  .detail-close { background: none; border: 1px solid var(--border); color: var(--muted); width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 16px; line-height: 1; flex-shrink: 0; }
  .detail-close:hover { background: var(--row-hover); color: var(--fg); border-color: var(--accent); }

  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); font-weight: 600; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; user-select: none; white-space: nowrap; }
  thead th:hover { color: var(--fg); }
  thead th.sorted::after { content: " ↓"; }
  thead th.sorted.asc::after { content: " ↑"; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--row-hover); }
  tbody tr.selected { background: var(--row-hover); box-shadow: inset 2px 0 0 var(--accent); }
  tbody td { padding: 8px 12px; border-bottom: 1px solid var(--row-border); vertical-align: top; }
  tbody td.t { max-width: 0; }
  tbody td.t > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .pri { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; min-width: 26px; text-align: center; }
  .pri-0 { background: var(--p0); color: white; }
  .pri-1 { background: var(--p1); color: white; }
  .pri-2 { background: var(--p2); color: white; }
  .pri-3 { background: var(--p3); color: white; }
  .pri-4 { background: var(--p4); color: white; }

  .status { color: var(--muted); font-size: 12px; }
  .status.open::before { content: "○ "; }
  .status.in_progress::before { content: "◐ "; color: var(--accent); }
  .status.closed::before { content: "✓ "; }
  .status.blocked::before { content: "● "; color: var(--p0); }
  .status.deferred::before { content: "❄ "; }

  .src { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--row-hover); color: var(--muted); display: inline-block; border: 1px solid var(--border); }
  .id { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: var(--muted); white-space: nowrap; }

  .detail .head { color: var(--muted); font-size: 12px; margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .detail .field { margin-bottom: 14px; }
  .detail .field-label { font-size: 10px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; margin-bottom: 4px; }
  .detail .content { white-space: pre-wrap; line-height: 1.5; word-wrap: break-word; }
  .detail a { color: var(--accent); }
  .detail details.field { margin-bottom: 10px; border: 1px solid var(--border); border-radius: 6px; }
  .detail details.field > summary { font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; cursor: pointer; user-select: none; list-style: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; }
  .detail details.field[open] > summary { border-radius: 6px 6px 0 0; border-bottom: 1px solid var(--border); }
  .detail details.field > summary::-webkit-details-marker { display: none; }
  .detail details.field > summary::before { content: '▸'; display: inline-block; transition: transform 0.15s; font-size: 11px; color: var(--accent); }
  .detail details.field[open] > summary::before { transform: rotate(90deg); }
  .detail details.field > summary:hover { background: var(--row-hover); color: var(--fg); }
  .detail details.field > .content { margin: 0; padding: 10px; }
  .detail .empty-field { color: var(--muted); font-style: italic; font-size: 13px; }
  .detail .summary-tag { font-size: 10px; color: var(--muted); font-style: italic; text-transform: none; letter-spacing: normal; margin-left: auto; }

  .empty-list { padding: 60px 40px; text-align: center; color: var(--muted); }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }

  header button.active { border-color: var(--accent); color: var(--accent); }
  tr.band-header td { background: var(--panel); color: var(--muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 8px 12px 4px; border-bottom: 1px solid var(--border); border-top: 2px solid var(--border); }
  tr.band-header:first-child td { border-top: none; }
  tr.epic-row td { border-left: 2px solid var(--accent); }
  tr.epic-row .src { border-color: var(--accent); color: var(--accent); }
  tr.dep-row td { border-left: 2px solid var(--border); }
  tr.row-closed { opacity: 0.4; }
  tr.selected.row-closed { opacity: 0.8; }
  .stale-badge { color: var(--p1); font-size: 10px; margin-left: 5px; cursor: default; vertical-align: middle; }
  .tree-connector { color: var(--muted); font-family: ui-monospace, "SF Mono", Menlo, monospace; user-select: none; margin-right: 2px; }
  .sign-out { font-size: 12px; color: var(--muted); background: none; border: 1px solid var(--border); padding: 4px 8px; border-radius: 4px; cursor: pointer; }
  .sign-out:hover { color: var(--fg); border-color: var(--accent); }
</style>
</head>
<body>

<div id="auth-overlay">
  <div class="auth-box">
    <h2>bdg dashboard</h2>
    <p>Sign in with your email to continue</p>
    <input id="auth-email" type="email" placeholder="you@example.com" autocomplete="email">
    <button id="auth-submit">Send magic link</button>
    <div class="auth-msg" id="auth-msg"></div>
  </div>
</div>

<header>
  <div class="header-main">
    <h1>bdg dashboard</h1>
    <input id="q" placeholder="Search id, title, description..." autofocus>
    <button id="refresh" title="Reload from DoltHub">⟳</button>
    <button id="group-toggle" title="Toggle grouped view">⊞</button>
    <button id="theme-toggle" title="Toggle theme (auto/light/dark)">◐</button>
    <span class="meta-info" id="meta">—</span>
    <button class="sign-out" id="sign-out" title="Sign out">Sign out</button>
  </div>
  <div class="header-filters">
    <select id="source"><option value="">all sources</option></select>
    <select id="status">
      <option value="!closed">active (not closed)</option>
      <option value="">all statuses</option>
      <option value="stale">stale (ready to close)</option>
      <option value="open">open</option>
      <option value="in_progress">in_progress</option>
      <option value="blocked">blocked</option>
      <option value="closed">closed</option>
      <option value="deferred">deferred</option>
    </select>
    <select id="priority">
      <option value="">all priorities</option>
      <option value="0">P0</option>
      <option value="1">P1</option>
      <option value="2">P2</option>
      <option value="3">P3</option>
      <option value="4">P4</option>
    </select>
    <span class="view-legend" id="view-legend"></span>
  </div>
</header>
<main>
  <div class="list" id="list"><div class="empty-list"><span class="spinner"></span></div></div>
  <div class="detail" id="detail"></div>
</main>

<script type="module">
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = '${supabaseUrl}';
const SUPABASE_ANON_KEY = '${supabaseAnonKey}';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true }
});

// ── Auth ──────────────────────────────────────────────────────────────────────

let session = null;

async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + '/dashboard',
      shouldCreateUser: false,
    },
  });
  return !error;
}

function initAuth() {
  supabase.auth.onAuthStateChange((event, s) => {
    session = s;
    if (s) {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') showDashboard();
    } else {
      showLogin();
    }
  });
}

function showLogin() {
  document.getElementById('auth-overlay').classList.remove('hidden');
}

function showDashboard() {
  document.getElementById('auth-overlay').classList.add('hidden');
  load(false);
}

// Auth form
document.getElementById('auth-submit').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value.trim();
  const msg = document.getElementById('auth-msg');
  const btn = document.getElementById('auth-submit');
  if (!email) { msg.textContent = 'Enter your email.'; msg.className = 'auth-msg error'; return; }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  msg.textContent = '';
  msg.className = 'auth-msg';
  const ok = await sendMagicLink(email);
  btn.disabled = false;
  btn.textContent = 'Send magic link';
  if (ok) {
    msg.textContent = 'Check your email for the magic link.';
    msg.className = 'auth-msg';
  } else {
    msg.textContent = 'Not authorised. Check your email address.';
    msg.className = 'auth-msg error';
  }
});
document.getElementById('auth-email').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('auth-submit').click();
});
document.getElementById('sign-out').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

let issues = [];
let selected = null;
let sortKey = 'updated_at';
let sortDir = -1;
if (!localStorage.getItem('viewMode') && localStorage.getItem('grouped') === '1') {
  localStorage.setItem('viewMode', 'bands');
}
let viewMode = localStorage.getItem('viewMode') || 'tree';

const typeRank = (i) => i.issue_type === 'epic' ? 0 : ((i.dependency_count||0) + (i.dependent_count||0) > 0 ? 1 : 2);
let staleParents = new Map();

function computeStaleParents(allIssues, closedIds) {
  const idMap = new Map(allIssues.map(i => [i.id, i]));
  const childrenOf = {};
  for (const i of allIssues) {
    for (const dep of (i.dependencies || [])) {
      const pid = dep.depends_on_id;
      if (!childrenOf[pid]) childrenOf[pid] = [];
      childrenOf[pid].push(i.id);
    }
  }
  const stale = new Map();
  for (const i of allIssues) {
    const es = effStatus(i, closedIds);
    if (es === 'closed' || es === 'completed') continue;
    const children = childrenOf[i.id] || [];
    if (children.length > 0) {
      if (children.every(cid => {
        const child = idMap.get(cid);
        return !child || effStatus(child, closedIds) === 'closed' || effStatus(child, closedIds) === 'completed';
      })) stale.set(i.id, 'done');
    } else if (i.issue_type === 'epic') {
      stale.set(i.id, 'unlinked');
    }
  }
  return stale;
}

function applyViewMode() {
  const btn = $('#group-toggle');
  const icons = { tree: '⊞', bands: '▦', flat: '☰' };
  const titles = {
    tree: 'Dependency chain view (next: priority bands)',
    bands: 'Priority bands view (next: flat)',
    flat: 'Flat sorted view (next: dep chain)',
  };
  const legends = {
    tree: '↑ Epics define the goal · Features scope the work · Tasks ↓ are the action',
    bands: 'grouped by priority',
    flat: 'sorted by column',
  };
  btn.textContent = icons[viewMode] || '⊞';
  btn.title = titles[viewMode] || '';
  btn.classList.toggle('active', viewMode !== 'flat');
  $('#view-legend').textContent = legends[viewMode] || '';
}

const $ = (s) => document.querySelector(s);
const list = $('#list'), detail = $('#detail'), metaEl = $('#meta');
const srcOf = (id) => { const i = id.lastIndexOf('-'); return i > 0 ? id.slice(0, i) : id; };

async function load() {
  if (!session) return;
  metaEl.innerHTML = '<span class="spinner"></span> loading…';
  try {
    const r = await fetch('/.netlify/functions/beads-issues', {
      headers: { 'Authorization': 'Bearer ' + session.access_token },
    });
    if (r.status === 401) { clearSession(); location.reload(); return; }
    if (!r.ok) throw new Error(r.statusText);
    issues = await r.json();
  } catch (e) {
    list.innerHTML = '<div class="empty-list">Failed to load: ' + e.message + '</div>';
    metaEl.textContent = 'error';
    return;
  }
  const sources = [...new Set(issues.map(i => srcOf(i.id)))].sort();
  const cur = $('#source').value;
  $('#source').innerHTML = '<option value="">all sources (' + issues.length + ')</option>' +
    sources.map(s => '<option value="' + s + '" ' + (cur===s?'selected':'') + '>' + s + ' (' + issues.filter(i=>srcOf(i.id)===s).length + ')</option>').join('');
  metaEl.textContent = issues.length + ' issues · loaded ' + new Date().toLocaleTimeString();
  render();
}

function effStatus(issue, closedIds) {
  if (issue.status !== 'open') return issue.status;
  const deps = issue.dependencies || [];
  if (Array.isArray(deps) && deps.length > 0 && deps.some(dep => !closedIds.has(dep.depends_on_id))) return 'blocked';
  return 'open';
}

const staleBadge = (i) => {
  const kind = staleParents.get(i.id);
  if (kind === 'done') return '<span class="stale-badge" title="All dependents are closed — ready to close?">⚠</span>';
  if (kind === 'unlinked') return '<span class="stale-badge" title="Open epic with no formal dep-graph links">⊙</span>';
  return '';
};

function typeBadge(i) {
  const t = (i.issue_type || i.type || '').toLowerCase();
  if (!t || t === 'task') return '';
  const filled = { epic: 'var(--p1)', feature: '#7c3aed', bug: 'var(--p0)', spike: 'var(--p2)' };
  if (filled[t]) return '<span class="type-badge" style="font-size:10px;padding:1px 5px;border-radius:3px;background:' + filled[t] + ';color:white;margin-right:5px;font-weight:600;vertical-align:middle;">' + t + '</span>';
  return '<span class="type-badge" style="font-size:10px;padding:1px 5px;border-radius:3px;border:1px solid var(--muted);color:var(--muted);margin-right:5px;font-weight:600;vertical-align:middle;">' + t + '</span>';
}

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const src = $('#source').value, st = $('#status').value, pr = $('#priority').value;
  const closedIds = new Set(issues.filter(i => i.status === 'closed' || i.status === 'completed').map(i => i.id));
  staleParents = computeStaleParents(issues, closedIds);
  let rows = issues.filter(i => {
    const es = effStatus(i, closedIds);
    if (src && srcOf(i.id) !== src) return false;
    if (st === '!closed') { if (es === 'closed' || es === 'completed') return false; }
    else if (st === 'stale') { if (!staleParents.has(i.id)) return false; }
    else if (st && es !== st) return false;
    if (pr !== '' && String(i.priority) !== pr) return false;
    if (q) {
      const hay = (i.title + ' ' + (i.description||'') + ' ' + (i.notes||'') + ' ' + i.id).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!rows.length) { list.innerHTML = '<div class="empty-list">No issues match filters.</div>'; return; }
  const header = (label, key, w='') => {
    const isSorted = viewMode === 'flat' && sortKey === key;
    return '<th data-key="' + key + '" class="' + (isSorted ? 'sorted ' + (sortDir===1?'asc':'') : '') + '" style="' + w + '">' + label + '</th>';
  };
  let bodyHtml;
  if (viewMode === 'bands') {
    rows.sort((a, b) => { if (a.priority !== b.priority) return a.priority - b.priority; if (typeRank(a) !== typeRank(b)) return typeRank(a) - typeRank(b); return (a.updated_at??'') < (b.updated_at??'') ? 1 : -1; });
    bodyHtml = buildBandsBody(rows, closedIds);
  } else if (viewMode === 'tree') {
    bodyHtml = buildTreeBody(rows, closedIds);
  } else {
    rows.sort((a, b) => { const av = a[sortKey]??'', bv = b[sortKey]??''; return (av < bv ? -1 : av > bv ? 1 : 0) * sortDir; });
    bodyHtml = buildFlatBody(rows, closedIds);
  }
  list.innerHTML = '<table><thead><tr>' +
    header('Source', 'id', 'width:90px;') +
    header('ID', 'id', 'width:130px;') +
    header('Title', 'title') +
    header('Status', 'status', 'width:120px;') +
    header('Pri', 'priority', 'width:60px;') +
    header('Updated', 'updated_at', 'width:100px;') +
    '</tr></thead><tbody>' + bodyHtml + '</tbody></table>';
  list.querySelectorAll('tbody tr[data-id]').forEach(tr => tr.addEventListener('click', () => showDetail(tr.dataset.id)));
  list.querySelectorAll('thead th').forEach(th => th.addEventListener('click', () => {
    if (viewMode !== 'flat') return;
    const k = th.dataset.key;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = (k==='updated_at'||k==='priority'?-1:1); }
    render();
  }));
}

function row(i, closedIds, extraClass='', indent=0, connector='') {
  const es = effStatus(i, closedIds);
  const cls = [selected===i.id?'selected':'', (es==='closed'||es==='completed')?'row-closed':'', extraClass].filter(Boolean).join(' ');
  return '<tr data-id="' + i.id + '" class="' + cls + '">' +
    '<td><span class="src">' + srcOf(i.id) + '</span></td>' +
    '<td><span class="id">' + i.id + '</span></td>' +
    '<td class="t"><div style="padding-left:' + indent + 'px;">' + connector + typeBadge(i) + esc(i.title) + staleBadge(i) + '</div></td>' +
    '<td><span class="status ' + es + '">' + es + '</span></td>' +
    '<td><span class="pri pri-' + i.priority + '">P' + i.priority + '</span></td>' +
    '<td class="status" title="' + (i.updated_at||'') + '">' + fmtDate(i.updated_at) + '</td>' +
    '</tr>';
}

function buildFlatBody(rows, closedIds) { return rows.map(i => row(i, closedIds)).join(''); }

function buildBandsBody(rows, closedIds) {
  let lastPri = -1;
  return rows.map(i => {
    let band = '';
    if (i.priority !== lastPri) { lastPri = i.priority; band = '<tr class="band-header"><td colspan="6">P' + i.priority + '</td></tr>'; }
    const extra = i.issue_type==='epic' ? 'epic-row' : (typeRank(i)===1 ? 'dep-row' : '');
    return band + row(i, closedIds, extra);
  }).join('');
}

function buildTreeBody(rows, closedIds) {
  const idMap = new Map(rows.map(i => [i.id, i]));
  const displayChildrenOf = {}, displayParentsOf = {};
  for (const i of rows) {
    for (const dep of (i.dependencies || [])) {
      const pid = dep.depends_on_id;
      if (!idMap.has(pid)) continue;
      if (!displayChildrenOf[i.id]) displayChildrenOf[i.id] = [];
      displayChildrenOf[i.id].push(pid);
      if (!displayParentsOf[pid]) displayParentsOf[pid] = [];
      displayParentsOf[pid].push(i.id);
    }
  }
  const primaryDisplayParent = {};
  for (const i of rows) {
    const dp = displayParentsOf[i.id] || [];
    primaryDisplayParent[i.id] = dp.length ? dp.reduce((best, p) => (idMap.get(p)?.priority??99) < (idMap.get(best)?.priority??99) ? p : best) : null;
  }
  const roots = rows.filter(i => !primaryDisplayParent[i.id]);
  roots.sort((a, b) => a.priority - b.priority || ((a.updated_at??'') < (b.updated_at??'') ? 1 : -1));
  const rendered = new Set(), parts = [];
  function renderNode(id, depth) {
    if (rendered.has(id)) return;
    rendered.add(id);
    const i = idMap.get(id); if (!i) return;
    const connector = depth > 0 ? '<span class="tree-connector">└─ </span>' : '';
    parts.push(row(i, closedIds, depth===0&&i.issue_type==='epic'?'epic-row':'', depth*20, connector));
    const children = (displayChildrenOf[id]||[]).filter(cid=>primaryDisplayParent[cid]===id)
      .map(cid=>idMap.get(cid)).filter(Boolean)
      .sort((a,b)=>a.priority-b.priority||((a.updated_at??'')<(b.updated_at??'')?1:-1));
    for (const child of children) renderNode(child.id, depth+1);
  }
  for (const root of roots) renderNode(root.id, 0);
  for (const i of rows) { if (!rendered.has(i.id)) renderNode(i.id, 0); }
  return parts.join('');
}

async function showDetail(id) {
  selected = id;
  document.body.classList.add('detail-open');
  list.querySelectorAll('tbody tr').forEach(tr => tr.classList.toggle('selected', tr.dataset.id===id));
  const base = issues.find(x => x.id === id);
  if (!base) { detail.innerHTML = '<div class="empty">Not found.</div>'; return; }
  detail.innerHTML = renderDetail(base);
  try {
    const r = await fetch('/.netlify/functions/beads-issue?id=' + encodeURIComponent(id), {
      headers: { 'Authorization': 'Bearer ' + session.access_token },
    });
    if (r.ok) detail.innerHTML = renderDetail({ ...base, ...await r.json() });
  } catch (_) {}
}

function closeDetail() {
  selected = null;
  document.body.classList.remove('detail-open');
  list.querySelectorAll('tbody tr').forEach(tr => tr.classList.remove('selected'));
  detail.innerHTML = '';
}

function collapsibleField(label, raw) {
  const has = raw && String(raw).trim().length > 0;
  const body = has ? '<div class="content">' + linkify(esc(raw)) + '</div>' : '<div class="content empty-field">(none)</div>';
  const tag = has ? '' : '<span class="summary-tag">empty</span>';
  return '<details class="field"><summary>' + label + tag + '</summary>' + body + '</details>';
}

function renderDetail(i) {
  const closedIds = new Set(issues.filter(x => x.status==='closed'||x.status==='completed').map(x=>x.id));
  const es = effStatus(i, closedIds);
  const itype = (i.issue_type||i.type||'task').toLowerCase();
  const deps = i.dependencies || [];
  let blockedByHtml = '';
  if (deps.length > 0) {
    const items = deps.map(dep => {
      const bid = dep.depends_on_id;
      const blocker = issues.find(x => x.id===bid);
      const bEs = blocker ? effStatus(blocker, closedIds) : 'unknown';
      const bTitle = blocker ? esc(blocker.title) : '(unknown)';
      const linkCls = blocker ? 'style="cursor:pointer;color:var(--accent);text-decoration:underline"' : '';
      const onClick = blocker ? 'onclick="showDetail(\'' + bid + '\')"' : '';
      return '<div style="display:flex;gap:8px;align-items:baseline;margin-bottom:4px;"><span class="status ' + bEs + '" style="flex-shrink:0;">' + bEs + '</span><span class="id">' + bid + '</span><span ' + linkCls + ' ' + onClick + '>' + bTitle + '</span></div>';
    });
    blockedByHtml = '<div class="field"><div class="field-label">Blocked by</div>' + items.join('') + '</div>';
  }
  return '<div class="detail-header"><h2>' + typeBadge(i) + esc(i.title) + '</h2><button class="detail-close" onclick="closeDetail()" title="Close (Esc)">×</button></div>' +
    '<div class="head"><span class="src">' + srcOf(i.id) + '</span><span class="id">' + i.id + '</span><span class="status ' + es + '">' + es + '</span><span class="pri pri-' + i.priority + '">P' + i.priority + '</span><span style="color:var(--muted);font-size:12px;">' + itype + '</span></div>' +
    blockedByHtml +
    (i.external_ref ? '<div class="field"><div class="field-label">External ref</div><div>' + esc(i.external_ref) + '</div></div>' : '') +
    collapsibleField('Description', i.description) +
    collapsibleField('Notes', i.notes) +
    '<div class="field"><div class="field-label">Updated</div><div>' + fmtDate(i.updated_at) + ' <span style="color:var(--muted)">(' + (i.updated_at||'') + ')</span></div></div>' +
    (i.owner ? '<div class="field"><div class="field-label">Owner</div><div>' + esc(i.owner) + '</div></div>' : '');
}

const esc = (s) => String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const linkify = (s) => s.replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" target="_blank">$1</a>');
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s), diff = (Date.now()-d)/1000;
  if (diff<60) return 'just now';
  if (diff<3600) return Math.floor(diff/60)+'m ago';
  if (diff<86400) return Math.floor(diff/3600)+'h ago';
  if (diff<604800) return Math.floor(diff/86400)+'d ago';
  return d.toISOString().slice(0,10);
}

['q','source','status','priority'].forEach(id => $('#'+id).addEventListener('input', render));
$('#status').addEventListener('change', () => localStorage.setItem('statusFilter', $('#status').value));
$('#refresh').addEventListener('click', () => load());
$('#group-toggle').addEventListener('click', () => {
  const next = { tree: 'bands', bands: 'flat', flat: 'tree' };
  viewMode = next[viewMode] || 'tree';
  localStorage.setItem('viewMode', viewMode);
  applyViewMode();
  render();
});

function applyTheme() {
  const stored = localStorage.getItem('theme');
  if (stored) document.documentElement.setAttribute('data-theme', stored);
  else document.documentElement.removeAttribute('data-theme');
  $('#theme-toggle').textContent = stored==='light'?'☀':stored==='dark'?'☾':'◐';
  $('#theme-toggle').title = 'Theme: '+(stored||'auto')+' (click to cycle)';
}
$('#theme-toggle').addEventListener('click', () => {
  const cur = localStorage.getItem('theme');
  const next = cur===null?'dark':cur==='dark'?'light':null;
  if (next===null) localStorage.removeItem('theme'); else localStorage.setItem('theme', next);
  applyTheme();
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
applyTheme();
applyViewMode();
$('#status').value = localStorage.getItem('statusFilter') ?? '!closed';

document.addEventListener('keydown', e => {
  if (e.key==='/' && document.activeElement!==$('#q')) { e.preventDefault(); $('#q').focus(); }
  if (e.key==='r' && (e.metaKey||e.ctrlKey)) { e.preventDefault(); load(); }
  if (e.key==='Escape') { if (selected) { closeDetail(); } else { $('#q').value=''; render(); } }
});

// Expose showDetail globally for inline onclick handlers in renderDetail
window.showDetail = showDetail;
window.closeDetail = closeDetail;

setInterval(() => { if (session) load(); }, 5 * 60 * 1000);

initAuth();
</script>
</body>
</html>`;

export default async function handler(req) {
  if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
    return new Response('Missing Supabase configuration', { status: 500 });
  }
  return new Response(HTML(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
