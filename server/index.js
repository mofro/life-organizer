import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { resolve } from 'path';
import { existsSync } from 'fs';

// BEADS_DIR env var overrides the default.
// On Railway: set BEADS_DIR=/app (the project root, which ships with .beads/ in the image).
// Locally: leave unset to use ~/beads-global as before.
const BDG_DIR = process.env.BEADS_DIR || resolve(homedir(), 'beads-global');
const PORT = process.env.PORT || 3001;

// BEADS_API_KEY — optional but strongly recommended in production.
// When set, all requests must include header: Authorization: Bearer <key>
// Locally (no key set) the server runs open — no auth required.
// Generate with: openssl rand -hex 32
const API_KEY = process.env.BEADS_API_KEY || null;

// --- Startup validation ---
// Fail loudly so "server offline" in the UI has an obvious cause in the logs.

let BD_PATH = null;
let BD_VERSION = null;

try {
  BD_PATH = execSync('which bd', { encoding: 'utf8', shell: '/bin/bash' }).trim();
  BD_VERSION = execSync('bd --version', { encoding: 'utf8', shell: '/bin/bash' }).trim();
  console.log(`[server] bd found: ${BD_PATH} (${BD_VERSION})`);
} catch {
  console.error('[server] FATAL: bd not found in PATH. Install Beads and ensure it is on PATH for /bin/bash.');
  console.error('[server] Run: which bd   (in a bash shell)');
  process.exit(1);
}

if (!existsSync(BDG_DIR)) {
  console.error(`[server] FATAL: beads-global directory not found: ${BDG_DIR}`);
  console.error('[server] Create it with: mkdir ~/beads-global && cd ~/beads-global && bd init');
  process.exit(1);
}

console.log(`[server] beads-global: ${BDG_DIR}`);

// --- App setup ---

const app = express();
app.use(cors());
app.use(express.json());

// Auth middleware — enforced only when BEADS_API_KEY is set.
// /api/health is always public (Railway uses it for readiness probes).
app.use((req, res, next) => {
  if (!API_KEY || req.path === '/api/health') return next();
  const header = req.headers['authorization'] || '';
  if (header === `Bearer ${API_KEY}`) return next();
  res.status(401).json({ error: 'Unauthorized' });
});

function bd(args, { sync = false } = {}) {
  // Use ; not && for sync — failure (e.g. no remote configured) must not block reads.
  const syncCmd = sync ? 'bd repo sync > /dev/null 2>&1 ; ' : '';
  const cmd = `${syncCmd}bd ${args} --json`;
  const raw = execSync(cmd, { cwd: BDG_DIR, encoding: 'utf8', shell: '/bin/bash' });
  const jsonEnd = raw.lastIndexOf(']');
  return JSON.parse(jsonEnd >= 0 ? raw.slice(0, jsonEnd + 1) : raw);
}

// GET /api/health — liveness + environment info
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, bdPath: BD_PATH, bdVersion: BD_VERSION, bdgDir: BDG_DIR });
});

// POST /api/beads/sync — pull latest data from DoltHub remote.
// Called by collect-world-state before fetching ready issues, ensuring
// Railway always serves data that is current as of the last bd dolt push.
// Non-blocking: responds immediately; pull runs synchronously but errors
// are swallowed so the caller can proceed with stale data if DoltHub is down.
app.post('/api/beads/sync', (_req, res) => {
  try {
    execSync('bd dolt pull origin', { cwd: BDG_DIR, encoding: 'utf8', shell: '/bin/bash' });
    res.json({ ok: true, syncedAt: new Date().toISOString() });
  } catch (e) {
    // Log but don't fail — caller proceeds with stale data
    console.warn('[server] bd dolt pull failed:', e.message);
    res.json({ ok: false, error: e.message, syncedAt: null });
  }
});

// GET /api/beads/ready — return unblocked open issues (no inline sync — caller triggers /api/beads/sync first)
app.get('/api/beads/ready', (_req, res) => {
  try {
    res.json(bd('ready --limit 0'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/beads/list?status=open — list issues (no sync — use ready for fresh data)
app.get('/api/beads/list', (req, res) => {
  try {
    const { status, priority } = req.query;
    let args = 'list';
    if (status)   args += ` --status=${status}`;
    if (priority) args += ` --priority=${priority}`;
    res.json(bd(args));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/beads/show/:id — single issue detail
app.get('/api/beads/show/:id', (req, res) => {
  try {
    const result = bd(`show ${req.params.id}`);
    res.json(Array.isArray(result) ? result[0] : result);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/beads/claim/:id — mark issue in_progress and assign to current user
app.post('/api/beads/claim/:id', (req, res) => {
  try {
    execSync(`bd update ${req.params.id} --claim`, {
      cwd: BDG_DIR, encoding: 'utf8', shell: '/bin/bash'
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/beads/close/:id — close issue with a required reason
app.post('/api/beads/close/:id', (req, res) => {
  const reason = req.body?.reason?.trim();
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  try {
    // Escape single quotes in reason to avoid shell injection
    const safe = reason.replace(/'/g, "'\\''");
    execSync(`bd close ${req.params.id} --reason='${safe}'`, {
      cwd: BDG_DIR, encoding: 'utf8', shell: '/bin/bash'
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/beads/create — create a new issue
// Body: { title (required), description, type, priority, labels }
// Uses execSync + JSON.parse directly — bd create --json returns {} not [].
app.post('/api/beads/create', (req, res) => {
  const { title, description, type, priority, labels } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const esc = (s) => String(s).replace(/'/g, "'\\''");

  let cmd = `bd create --title='${esc(title)}'`;
  if (description) cmd += ` --description='${esc(description)}'`;
  if (type)        cmd += ` --type='${esc(type)}'`;
  if (priority != null) cmd += ` --priority=${parseInt(priority, 10)}`;
  if (labels) {
    const labelStr = Array.isArray(labels) ? labels.join(',') : String(labels);
    cmd += ` --labels='${esc(labelStr)}'`;
  }
  cmd += ' --json';

  try {
    const raw = execSync(cmd, { cwd: BDG_DIR, encoding: 'utf8', shell: '/bin/bash' });
    res.status(201).json(JSON.parse(raw));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/beads/stats
app.get('/api/beads/stats', (_req, res) => {
  try {
    res.json(bd('stats'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});
