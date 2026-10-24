#!/usr/bin/env node
'use strict';

const fs = require('fs');

// Singleton lock: bail if another sync is already running.
const LOCK_FILE = '/tmp/beads-reminders-sync.lock';
try {
  fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
} catch {
  process.exit(0); // another instance is running — skip silently
}
const releaseLock = () => { try { fs.unlinkSync(LOCK_FILE); } catch {} };
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

const { loadConfig } = require('./config');
const { loadState, saveState } = require('./state');
const { syncBeadsToReminders } = require('./beads-to-reminders');
const { syncRemindersToBeads } = require('./reminders-to-beads');

const args = process.argv.slice(2);
const directionArg = args.find(a => a.startsWith('--direction='));
const direction = directionArg ? directionArg.split('=')[1] : 'both';
const verbose = args.includes('--verbose');

function makeLogger(config) {
  const isVerbose = verbose || config.verbose;
  return (msg) => {
    if (isVerbose || msg.startsWith('ERROR') || msg.startsWith('Creating') || msg.startsWith('Updating') || msg.startsWith('Closing') || msg.startsWith('Reopening')) {
      const ts = new Date().toISOString();
      process.stdout.write(`[${ts}] [beads-reminders-sync] ${msg}\n`);
    }
  };
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e.code === 'CONFIG_MISSING') process.exit(0); // Silent — not configured
    process.stderr.write(`Config error: ${e.message}\n`);
    process.exit(1);
  }

  const log = makeLogger(config);
  const state = loadState();

  log(`Starting sync (direction=${direction})`);

  try {
    if (direction === 'beads-to-reminders' || direction === 'both') {
      await syncBeadsToReminders(config, state, log);
    }

    if (direction === 'reminders-to-beads' || direction === 'both') {
      await syncRemindersToBeads(config, state, log);
    }
  } catch (e) {
    log(`ERROR: ${e.message}`);
    if (verbose || config.verbose) console.error(e.stack);
  } finally {
    saveState(state);
  }

  log('Sync complete');
}

main().catch(e => {
  process.stderr.write(`Fatal: ${e.message}\n`);
  process.exit(1);
});
