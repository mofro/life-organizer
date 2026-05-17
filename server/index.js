import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { resolve } from 'path';

// Use ~/beads-global for the cross-project unified view (bdg).
// Per-project bd stays untouched — we're read-only here.
const BDG_DIR = resolve(homedir(), 'beads-global');
const PORT = 3001;

const app = express();
app.use(cors());
app.use(express.json());

function bd(args, { sync = false } = {}) {
  // Mirror what bdg shell function does: optionally sync first, then bd.
  const syncCmd = sync ? 'bd repo sync > /dev/null 2>&1 && ' : '';
  const cmd = `${syncCmd}bd ${args} --json`;
  const raw = execSync(cmd, { cwd: BDG_DIR, encoding: 'utf8', shell: '/bin/zsh' });
  // bd list appends a non-JSON footer line — strip anything after the closing ]
  const jsonEnd = raw.lastIndexOf(']');
  return JSON.parse(jsonEnd >= 0 ? raw.slice(0, jsonEnd + 1) : raw);
}

// GET /api/beads/ready — sync then return unblocked open issues across all projects
app.get('/api/beads/ready', (_req, res) => {
  try {
    res.json(bd('ready', { sync: true }));
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
    // bd show --json returns an array; unwrap to single object
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
  console.log(`Beads API server → ${BDG_DIR}`);
  console.log(`Listening on http://localhost:${PORT}`);
});
