import express from 'express';
import cors from 'cors';
import { execSync, spawnSync } from 'child_process';
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

let BD_PATH = null;
let BD_VERSION = null;

try {
  BD_PATH = execSync('which bd', { encoding: 'utf8', shell: '/bin/bash' }).trim();
  BD_VERSION = execSync('bd --version', { encoding: 'utf8', shell: '/bin/bash' }).trim();
  console.log(`[server] bd found: ${BD_PATH} (${BD_VERSION})`);
} catch {
  console.error('[server] FATAL: bd not found in PATH. Install Beads and ensure it is on PATH for /bin/bash.');
  process.exit(1);
}

if (!existsSync(BDG_DIR)) {
  console.error(`[server] FATAL: beads-global directory not found: ${BDG_DIR}`);
  process.exit(1);
}

console.log(`[server] beads-global: ${BDG_DIR}`);

// --- Input validation helpers ---

// Beads IDs follow the pattern <prefix>-<alphanumeric>, e.g. life-wut, life-abc123.
function validateId(id) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9]*-[a-z0-9]+$/.test(id)) {
    const err = new Error('Invalid issue ID');
    err.status = 400;
    throw err;
  }
  return id;
}

const VALID_STATUSES = new Set(['open', 'in_progress', 'blocked', 'closed', 'deferred']);
const VALID_TYPES    = new Set(['bug', 'feature', 'task', 'epic']);

// --- bd runner (no shell) ---

// Runs bd with an args array via spawnSync — no shell involved so no injection possible.
// Appends --json automatically. Throws on non-zero exit.
function runBd(args) {
  const result = spawnSync('bd', [...args, '--json'], {
    cwd: BDG_DIR,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || 'bd command failed').trim();
    console.error('[server] bd error:', msg);
    throw new Error('bd command failed');
  }
  const raw = result.stdout;
  const jsonEnd = raw.lastIndexOf(']');
  return JSON.parse(jsonEnd >= 0 ? raw.slice(0, jsonEnd + 1) : raw);
}

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

// GET /api/health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, bdVersion: BD_VERSION });
});

// POST /api/beads/sync — pull latest data from DoltHub remote.
app.post('/api/beads/sync', (_req, res) => {
  const result = spawnSync('bd', ['dolt', 'pull', 'origin'], {
    cwd: BDG_DIR,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.warn('[server] bd dolt pull failed:', (result.stderr || '').trim());
    return res.json({ ok: false, error: 'sync failed', syncedAt: null });
  }
  res.json({ ok: true, syncedAt: new Date().toISOString() });
});

// GET /api/beads/ready
app.get('/api/beads/ready', (_req, res) => {
  try {
    res.json(runBd(['ready', '--limit', '0']));
  } catch {
    res.status(500).json({ error: 'internal error' });
  }
});

// GET /api/beads/list?status=open&priority=2
app.get('/api/beads/list', (req, res) => {
  try {
    const args = ['list'];
    const { status, priority } = req.query;

    if (status != null && status !== '') {
      if (!VALID_STATUSES.has(status)) return res.status(400).json({ error: 'invalid status' });
      args.push('--status', status);
    }
    if (priority != null && priority !== '') {
      const p = parseInt(priority, 10);
      if (isNaN(p) || p < 0 || p > 4) return res.status(400).json({ error: 'invalid priority' });
      args.push('--priority', String(p));
    }

    res.json(runBd(args));
  } catch {
    res.status(500).json({ error: 'internal error' });
  }
});

// GET /api/beads/show/:id
app.get('/api/beads/show/:id', (req, res) => {
  try {
    validateId(req.params.id);
    const result = runBd(['show', req.params.id]);
    res.json(Array.isArray(result) ? result[0] : result);
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    res.status(404).json({ error: 'internal error' });
  }
});

// POST /api/beads/claim/:id
app.post('/api/beads/claim/:id', (req, res) => {
  try {
    validateId(req.params.id);
    const result = spawnSync('bd', ['update', req.params.id, '--claim'], {
      cwd: BDG_DIR,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      console.error('[server] bd claim error:', (result.stderr || '').trim());
      return res.status(500).json({ error: 'internal error' });
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: 'internal error' });
  }
});

// POST /api/beads/close/:id
app.post('/api/beads/close/:id', (req, res) => {
  const reason = req.body?.reason?.trim();
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  try {
    validateId(req.params.id);
    const result = spawnSync('bd', ['close', req.params.id, '--reason', reason], {
      cwd: BDG_DIR,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      console.error('[server] bd close error:', (result.stderr || '').trim());
      return res.status(500).json({ error: 'internal error' });
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: 'internal error' });
  }
});

// POST /api/beads/create
app.post('/api/beads/create', (req, res) => {
  const { title, description, type, priority, labels } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (type && !VALID_TYPES.has(type)) return res.status(400).json({ error: 'invalid type' });

  const args = ['create', '--title', title.trim()];
  if (description) args.push('--description', String(description));
  if (type)        args.push('--type', type);
  if (priority != null) {
    const p = parseInt(priority, 10);
    if (isNaN(p) || p < 0 || p > 4) return res.status(400).json({ error: 'invalid priority' });
    args.push('--priority', String(p));
  }
  if (labels) {
    const labelStr = Array.isArray(labels) ? labels.join(',') : String(labels);
    args.push('--labels', labelStr);
  }

  try {
    const result = spawnSync('bd', [...args, '--json'], {
      cwd: BDG_DIR,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      console.error('[server] bd create error:', (result.stderr || '').trim());
      return res.status(500).json({ error: 'internal error' });
    }
    res.status(201).json(JSON.parse(result.stdout));
  } catch {
    res.status(500).json({ error: 'internal error' });
  }
});

// GET /api/beads/stats
app.get('/api/beads/stats', (_req, res) => {
  try {
    res.json(runBd(['stats']));
  } catch {
    res.status(500).json({ error: 'internal error' });
  }
});

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});
