'use strict';

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(process.env.HOME, '.beads-reminders-state.json');

const DEFAULT_STATE = {
  lastPollAt: null,
  lastSyncAtByBeadsId: {},
  reminderUuidToBeadsId: {},
  participants: [],
};

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
    }
  } catch (_) {}
  return { ...DEFAULT_STATE };
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

// Returns true if a > b accounting for 5s clock skew
function isDefinitelyNewer(a, b) {
  if (!a || !b) return !!a;
  return new Date(a).getTime() > new Date(b).getTime() + 5000;
}

module.exports = { loadState, saveState, isDefinitelyNewer, STATE_PATH };
