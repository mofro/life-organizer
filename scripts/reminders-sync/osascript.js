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
    dueDate:    r.dueDate || null,
    priority:   r.priority || 0,
    flagged:    Boolean(r.flagged),
    tags:       Array.isArray(r.tags) ? r.tags : [],
  })).filter(r => r.uuid);
}

// Returns single reminder or null.
// Uses SQLite (getAllRemindersInList) to avoid ETIMEDOUT on shared iCloud lists.
function getReminderById(uuid, listName) {
  const all = getAllRemindersInList(listName);
  return all.find(r => r.uuid === uuid) || null;
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

// isoDate: YYYY-MM-DD string, or null to clear the due date.
// Uses the shell date command to convert to a locale-independent AppleScript date.
function updateReminderDueDate(uuid, listName, isoDate) {
  if (isoDate === null || isoDate === undefined) {
    runMultiline(`
tell application "Reminders"
  ${lookupClause(uuid, listName)}
  set due date of target to missing value
end tell`);
    return;
  }
  const dateOnly = isoDate.slice(0, 10); // YYYY-MM-DD
  runMultiline(`
tell application "Reminders"
  ${lookupClause(uuid, listName)}
  set dsStr to (do shell script "date -jf '%Y-%m-%d' '${dateOnly}' '+%B %e, %Y'")
  set due date of target to date dsStr
end tell`);
}

// icalPriority: 0=none, 1=high, 5=medium, 9=low (iCal integer encoding).
function updateReminderPriority(uuid, listName, icalPriority) {
  runMultiline(`
tell application "Reminders"
  ${lookupClause(uuid, listName)}
  set priority of target to ${icalPriority || 0}
end tell`);
}

module.exports = {
  getAllRemindersInList,
  getReminderById,
  createReminder,
  updateReminderName,
  updateReminderBody,
  updateReminderCompleted,
  updateReminderDueDate,
  updateReminderPriority,
};
