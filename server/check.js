#!/usr/bin/env node
// Pre-flight check: validates all prerequisites before starting the dev server.
// Run via: npm run check

import { execSync } from 'child_process';
import { homedir } from 'os';
import { resolve } from 'path';
import { existsSync } from 'fs';

let ok = true;

function pass(msg) { console.log(`  ✓  ${msg}`); }
function fail(msg) { console.error(`  ✗  ${msg}`); ok = false; }

console.log('\nLife Organizer — pre-flight check\n');

// Node version
const nodeVer = process.versions.node.split('.').map(Number);
if (nodeVer[0] >= 18) {
  pass(`Node.js ${process.versions.node}`);
} else {
  fail(`Node.js 18+ required (found ${process.versions.node})`);
}

// bd CLI
try {
  const path = execSync('which bd', { encoding: 'utf8', shell: '/bin/zsh' }).trim();
  const ver  = execSync('bd --version', { encoding: 'utf8', shell: '/bin/zsh' }).trim();
  pass(`bd CLI: ${path} (${ver})`);
} catch {
  fail('bd CLI not found in PATH — install Beads: https://github.com/gastownhall/beads');
}

// beads-global directory
const bdgDir = resolve(homedir(), 'beads-global');
if (existsSync(bdgDir)) {
  pass(`beads-global: ${bdgDir}`);
} else {
  fail(`~/beads-global not found — create with: mkdir ~/beads-global && cd ~/beads-global && bd init`);
}

// node_modules
if (existsSync(resolve(process.cwd(), 'node_modules'))) {
  pass('node_modules present');
} else {
  fail('node_modules missing — run: npm install');
}

console.log('');

if (!ok) {
  console.error('Pre-flight failed. Fix the issues above, then run: npm start\n');
  process.exit(1);
}

console.log('All checks passed. Run: npm start\n');
