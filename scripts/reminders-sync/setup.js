#!/usr/bin/env node
'use strict';

// Interactive setup for Beads ↔ Apple Reminders sync.
// Run once: node ~/Code/life-organizer/scripts/reminders-sync/setup.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(process.env.HOME, '.beads-reminders-config.json');
const PLIST_TEMPLATE = path.join(__dirname, 'com.beads.reminders-sync.plist');
const PLIST_DEST = path.join(process.env.HOME, 'Library/LaunchAgents/com.beads.reminders-sync.plist');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue) {
  return new Promise(resolve => {
    const hint = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${question}${hint}: `, answer => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function askYN(question, defaultYes = true) {
  return new Promise(resolve => {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    rl.question(`${question} ${hint}: `, answer => {
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

function runSilent(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  } catch (_) {
    return null;
  }
}

function getRemindersLists() {
  try {
    const raw = execSync(
      `osascript -e 'tell application "Reminders" to get name of every list'`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    return raw.split(', ').map(s => s.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function getParticipants(listName) {
  const script = path.join(__dirname, 'get-participants.py');
  try {
    const raw = execSync(`python3 "${script}" "${listName}"`, {
      encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function getNodePath() {
  return runSilent('node -e "process.stdout.write(process.execPath)"') || '/usr/local/bin/node';
}

// Project root: two dirs up from scripts/reminders-sync/
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function getBdOwner() {
  return runSilent('bd config get owner 2>/dev/null') ||
    runSilent(`git -C "${PROJECT_ROOT}" config user.email`) ||
    '';
}

function getBdDisplayName() {
  return runSilent(`git -C "${PROJECT_ROOT}" config user.name`) || '';
}

function loadExisting() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) {}
  return null;
}

function checkStatus() {
  const configExists = fs.existsSync(CONFIG_PATH);
  const daemonLoaded = !!runSilent('launchctl list com.beads.reminders-sync 2>/dev/null');
  const plistInstalled = fs.existsSync(PLIST_DEST);

  console.log('\n── Current status ──────────────────────────────────');
  console.log(`  Config   ${configExists   ? '✅  ' + CONFIG_PATH : '❌  not found'}`);
  console.log(`  Plist    ${plistInstalled ? '✅  ' + PLIST_DEST  : '❌  not installed'}`);
  console.log(`  Daemon   ${daemonLoaded   ? '✅  running'        : '❌  not loaded'}`);
  console.log('');
  return { configExists, daemonLoaded, plistInstalled };
}

async function main() {
  console.log('\n🔧  Beads ↔ Apple Reminders — interactive setup');
  console.log('    Safe to re-run at any time — existing values shown as defaults.\n');

  const status = checkStatus();
  const existing = loadExisting();

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    console.log('\n\nInterrupted. Nothing was changed since the last saved step.');
    if (fs.existsSync(CONFIG_PATH)) {
      console.log(`Config at ${CONFIG_PATH} is unchanged.`);
    }
    console.log('Run setup again to continue.\n');
    rl.close();
    process.exit(0);
  });

  if (status.configExists && status.daemonLoaded) {
    console.log('Everything looks set up. Choose what to do:');
    const rerun = await askYN('Walk through all settings again?', false);
    if (!rerun) { rl.close(); return; }
  }

  // --- Detect defaults ---
  const detectedName = getBdDisplayName();
  const detectedOwner = getBdOwner();
  const nodePath = getNodePath();

  console.log('\n── Your identity ──────────────────────────────────');

  const username = await ask(
    'Short username (used as [tag] in Reminders titles)',
    existing?.username || detectedName.split(' ')[0] || 'me'
  );

  const displayName = await ask(
    'Your full display name (matches Beads assignee field)',
    existing?.displayName || detectedName || username
  );

  const beadsOwner = await ask(
    'Your Beads owner email',
    existing?.beadsOwner || detectedOwner || ''
  );

  // --- Reminders list ---
  console.log('\n── Reminders list ─────────────────────────────────');
  const lists = getRemindersLists();
  if (lists.length > 0) {
    console.log('Your Reminders lists:');
    lists.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
  }

  const listDefault = existing?.remindersListName ||
    (lists.includes('Family') ? 'Family' : lists[0]) || 'Family';
  const listInput = await ask('Which Reminders list to sync with (name or number)', listDefault);

  // Accept numeric selection
  const listNum = parseInt(listInput, 10);
  const remindersListName = (!isNaN(listNum) && listNum >= 1 && listNum <= lists.length)
    ? lists[listNum - 1]
    : listInput;

  console.log(`  → Using list: "${remindersListName}"`);

  // --- Sync label ---
  console.log('\n── Sync label ──────────────────────────────────────');
  const syncLabel = await ask(
    'Beads label that opts an issue into Reminders sync',
    existing?.syncLabel || 'todo'
  );

  // --- Discover participants from Reminders SQLite ---
  console.log('\n── Shared list participants ─────────────────────────');
  const discovered = getParticipants(remindersListName);
  const tagMap = existing?.usernameOverrides || {};

  if (discovered.length > 0) {
    console.log(`  Found ${discovered.length} participant(s) in "${remindersListName}":\n`);

    for (const p of discovered) {
      const isOwner = p.email === beadsOwner ||
        p.displayName.toLowerCase() === (displayName || '').toLowerCase();

      if (isOwner) {
        console.log(`  [${username}]  ${p.displayName} <${p.email}>  ← you`);
        continue;
      }

      const autoTag = tagMap[p.displayName] || p.givenName.toLowerCase() || p.email.split('@')[0];
      console.log(`  [${autoTag}]  ${p.displayName} <${p.email}>`);
      const correct = await askYN(`  Use "${autoTag}" as the short tag for ${p.displayName}?`, true);
      if (!correct) {
        const custom = await ask(`  Short tag for ${p.displayName}`, autoTag);
        if (custom) tagMap[p.displayName] = custom;
      } else {
        tagMap[p.displayName] = autoTag;
      }
    }
  } else {
    console.log(`  (Could not read participants from Reminders data — list may not be shared.)`);
    console.log(`  Add participants manually:\n`);
    while (true) {
      const pName = await ask('  Full name (blank to finish)');
      if (!pName) break;
      const defaultTag = pName.split(' ')[0].toLowerCase();
      const pTag = await ask(`  Short tag for ${pName}`, tagMap[pName] || defaultTag);
      if (pTag) tagMap[pName] = pTag;
    }
  }

  // --- Write config ---
  const config = {
    username,
    displayName,
    beadsOwner: beadsOwner || null,
    remindersListName,
    syncLabel,
    usernameOverrides: tagMap,
    beadsGlobalPath: PROJECT_ROOT,
    verbose: false,
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`\n✅  Config written to ${CONFIG_PATH}`);

  // --- launchd daemon ---
  console.log('\n── Polling daemon (Reminders → Beads every 60s) ────');
  const daemonAlready = status.daemonLoaded;
  const installDaemon = await askYN(
    daemonAlready ? 'Daemon already running — reinstall it?' : 'Install the launchd polling daemon?',
    !daemonAlready
  );

  if (installDaemon) {
    const plistTemplate = fs.readFileSync(PLIST_TEMPLATE, 'utf8');
    const plistContent = plistTemplate
      .replace(/\/Users\/mo\/.nvm\/versions\/node\/v22\.21\.1\/bin\/node/g, nodePath)
      .replace(/\/Users\/mo\//g, process.env.HOME + '/')
      // Remove XML comments (launchd rejects them in some versions)
      .replace(/<!--[^>]*-->/g, '');

    fs.mkdirSync(path.dirname(PLIST_DEST), { recursive: true });
    fs.writeFileSync(PLIST_DEST, plistContent, 'utf8');
    console.log(`  Plist written to ${PLIST_DEST}`);

    // Unload first in case it was previously loaded
    runSilent(`launchctl unload "${PLIST_DEST}" 2>/dev/null`);
    const loadResult = runSilent(`launchctl load "${PLIST_DEST}"`);
    if (loadResult !== null) {
      console.log('  Daemon loaded ✅');
    } else {
      console.log('  ⚠️  launchctl load failed — try manually:');
      console.log(`     launchctl load "${PLIST_DEST}"`);
    }
  }

  // --- Reminders automation permission ---
  console.log('\n── Reminders automation permission ─────────────────');
  console.log('macOS requires explicit permission for scripts to control Reminders.');
  console.log('If prompted by macOS, click "Allow" when the dialog appears.\n');

  const testNow = await askYN('Run a test sync now to verify everything works?', true);
  if (testNow) {
    console.log('\nRunning sync --direction=both --verbose …\n');
    try {
      execSync(
        `"${nodePath}" "${path.join(__dirname, 'sync.js')}" --direction=both --verbose`,
        { stdio: 'inherit', timeout: 60000, cwd: PROJECT_ROOT }
      );
    } catch (e) {
      console.error('\n⚠️  Sync exited with error — check output above.');
    }
  }

  console.log('\n── Done ────────────────────────────────────────────');
  console.log('To sync manually at any time:');
  console.log(`  node ${path.join(__dirname, 'sync.js')} --direction=both --verbose`);
  console.log('\nTo tag a Beads issue for Reminders sync:');
  console.log(`  bd update <id> --add-label ${syncLabel}`);
  console.log('\nLogs:');
  console.log('  Beads→Reminders: ~/.beads-reminders-sync.log');
  console.log('  Reminders→Beads: /tmp/beads-reminders-sync.log\n');

  rl.close();
}

main().catch(e => {
  console.error('Setup failed:', e.message);
  rl.close();
  process.exit(1);
});
