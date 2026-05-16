import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(__dirname, '..');
const PORT = 3001;

const app = express();
app.use(cors());
app.use(express.json());

function bd(args) {
  const cmd = `bd ${args} --json`;
  const result = execSync(cmd, { cwd: WORKSPACE, encoding: 'utf8' });
  return JSON.parse(result);
}

// GET /api/beads/ready — unblocked open issues
app.get('/api/beads/ready', (_req, res) => {
  try {
    const issues = bd('ready');
    res.json(issues);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/beads/list?status=open — list issues with optional filter
app.get('/api/beads/list', (req, res) => {
  try {
    const { status, priority } = req.query;
    let args = 'list';
    if (status)   args += ` --status=${status}`;
    if (priority) args += ` --priority=${priority}`;
    const issues = bd(args);
    res.json(issues);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/beads/show/:id — single issue detail
app.get('/api/beads/show/:id', (req, res) => {
  try {
    const issue = bd(`show ${req.params.id}`);
    res.json(issue);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// GET /api/beads/stats — project statistics
app.get('/api/beads/stats', (_req, res) => {
  try {
    const stats = bd('stats');
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Beads API server running at http://localhost:${PORT}`);
  console.log(`Workspace: ${WORKSPACE}`);
});
