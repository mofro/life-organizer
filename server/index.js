import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { resolve } from 'path';
import { existsSync } from 'fs';

const BDG_DIR = resolve(homedir(), 'beads-global');
const PORT = 3001;

// --- Startup validation ---
// Fail loudly so "server offline" in the UI has an obvious cause in the logs.

let BD_PATH = null;
let BD_VERSION = null;

try {
  BD_PATH = execSync('which bd', { encoding: 'utf8', shell: '/bin/zsh' }).trim();
  BD_VERSION = execSync('bd --version', { encoding: 'utf8', shell: '/bin/zsh' }).trim();
  console.log(`[server] bd found: ${BD_PATH} (${BD_VERSION})`);
} catch {
  console.error('[server] FATAL: bd not found in PATH. Install Beads and ensure it is on PATH for /bin/zsh.');
  console.error('[server] Run: which bd   (in a zsh shell, not sh)');
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

function bd(args, { sync = false } = {}) {
  const syncCmd = sync ? 'bd repo sync > /dev/null 2>&1 && ' : '';
  const cmd = `${syncCmd}bd ${args} --json`;
  const raw = execSync(cmd, { cwd: BDG_DIR, encoding: 'utf8', shell: '/bin/zsh' });
  const jsonEnd = raw.lastIndexOf(']');
  return JSON.parse(jsonEnd >= 0 ? raw.slice(0, jsonEnd + 1) : raw);
}

// GET /api/health — liveness + environment info
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, bdPath: BD_PATH, bdVersion: BD_VERSION, bdgDir: BDG_DIR });
});

// GET /api/beads/ready — sync then return unblocked open issues across all projects
app.get('/api/beads/ready', (_req, res) => {
  try {
    res.json(bd('ready --limit 0', { sync: true }));
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
