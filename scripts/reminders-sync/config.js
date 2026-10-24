'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(process.env.HOME, '.beads-reminders-config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const err = new Error(`Config not found: ${CONFIG_PATH}`);
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    const err = new Error(`Config parse error in ${CONFIG_PATH}: ${e.message}`);
    err.code = 'CONFIG_INVALID';
    throw err;
  }

  const required = ['username', 'remindersListName', 'syncLabel'];
  for (const key of required) {
    if (!raw[key]) {
      const err = new Error(`Config missing required field: ${key}`);
      err.code = 'CONFIG_INVALID';
      throw err;
    }
  }

  return {
    username: raw.username,
    displayName: raw.displayName || raw.username,
    beadsOwner: raw.beadsOwner || null,
    remindersListName: raw.remindersListName,
    syncLabel: raw.syncLabel,
    usernameOverrides: raw.usernameOverrides || {},
    beadsGlobalPath: raw.beadsGlobalPath || path.join(process.env.HOME, 'beads-global'),
    verbose: raw.verbose || false,
  };
}

module.exports = { loadConfig, CONFIG_PATH };
