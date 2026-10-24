'use strict';

const { execSync } = require('child_process');
const path = require('path');

function run(script) {
  return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function runMultiline(script) {
  return execSync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, {
    encoding: 'utf8',
    timeout: 30000,
    shell: '/bin/bash',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

// Scoped reminder lookup clause — always searches within the named list.
// Faster than cross-list search and grows O(list-size) not O(all-reminders).
function lookupClause(uuid, listName) {
  return `set theList to list "${listName}"
  set target to first reminder of theList whose id = "x-apple-reminder://${uuid}"`;
}

// Returns array of { uuid, name, body, completed, modifiedAt }
// Beads ID is NOT stored in the reminder; use state.reminderUuidToBeadsId[uuid] to look it up.
//
// Uses SQLite direct-read (get-reminders.py) to bypass the iCloud round-trip
// that AppleScript requires for shared lists — prevents ETIMEDOUT on Family etc.
function getAllRemindersInList(listName) {
  const script = path.join(__dirname, 'get-reminders.py');
  let raw;
  try {
    raw = execSync(`python3 "${script}" "${listName.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    throw new Error(`Failed to read reminders from "${listName}": ${e.message}`);
  }

  if (!raw) return [];

  let rows;
  try {
    rows = JSON.parse(raw);
  } catch (e) {
    throw new Error(`get-reminders.py returned invalid JSON for "${listName}": ${e.message}`);
  }

  return rows.map(r => ({
    uuid:       r.uuid,
    name:       r.name || '',
    body:       r.body || '',
    completed:  Boolean(r.completed),
    modifiedAt: r.modifiedAt || null,
  })).filter(r => r.uuid);
}

// Returns single reminder or null
function getReminderById(uuid, listName) {
  const script = `
tell application "Reminders"
  ${lookupClause(uuid, listName)}
  set tBody to body of target
  if tBody is missing value then set tBody to ""
  return (name of target) & "|||" & tBody & "|||" & ((completed of target) as string) & "|||" & ((modification date of target) as string)
end tell`;

  let raw;
  try {
    raw = runMultiline(script);
  } catch (_) {
    return null;
  }

  if (!raw) return null;
  const parts = raw.split('|||');
  return {
    uuid,
    name: (parts[0] || '').trim(),
    body: (parts[1] || '').trim(),
    completed: (parts[2] || '').trim() === 'true',
    modifiedAt: (parts[3] || '').trim() || null,
  };
}

// Returns UUID of new reminder.
function createReminder(listName, name, body) {
  const escapedName = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedBody = (body || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
tell application "Reminders"
  set r to make new reminder at end of list "${listName}" with properties {name:"${escapedName}", body:"${escapedBody}"}
  return id of r
end tell`;

  const raw = runMultiline(script);
  return raw.replace(/^x-apple-reminder:\/\//, '').trim();
}

function updateReminderName(uuid, listName, name) {
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  runMultiline(`
tell application "Reminders"
  ${lookupClause(uuid, listName)}
  set name of target to "${escaped}"
end tell`);
}

function updateReminderBody(uuid, listName, body) {
  const escaped = (body || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  runMultiline(`
tell application "Reminders"
  ${lookupClause(uuid, listName)}
  set body of target to "${escaped}"
end tell`);
}

function updateReminderCompleted(uuid, listName, completed) {
  runMultiline(`
tell application "Reminders"
  ${lookupClause(uuid, listName)}
  set completed of target to ${completed ? 'true' : 'false'}
end tell`);
}

module.exports = {
  getAllRemindersInList,
  getReminderById,
  createReminder,
  updateReminderName,
  updateReminderBody,
  updateReminderCompleted,
};
