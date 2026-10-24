'use strict';

const { execSync } = require('child_process');
const osa = require('./osascript');
const { isDefinitelyNewer } = require('./state');
const { buildParticipantMap } = require('./beads-to-reminders');

const PREFIX_RE = /^\[([^\]]+)\]\s*/;
const MS_PER_DAY = 86400000;

function bdJson(args, cwd) {
  try {
    const raw = execSync(`bd ${args} --json`, { cwd, encoding: 'utf8', timeout: 30000 });
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function syncRemindersToBeads(config, state, log) {
  const cwd = config.beadsGlobalPath;

  // Use saved participant map (populated by beads-to-reminders or a previous run)
  const participants = state.participants || [];

  const reminders = osa.getAllRemindersInList(config.remindersListName);
  log(`Found ${reminders.length} reminder(s) in "${config.remindersListName}"`);

  const cutoff = state.lastPollAt
    ? new Date(state.lastPollAt)
    : new Date(Date.now() - MS_PER_DAY); // first run: look back 24h

  for (const reminder of reminders) {
    try {
      await processReminder(reminder, config, state, participants, cutoff, cwd, log);
    } catch (e) {
      log(`ERROR processing reminder "${reminder.name}": ${e.message}`);
    }
  }

  state.lastPollAt = new Date().toISOString();
}

async function processReminder(reminder, config, state, participants, cutoff, cwd, log) {
  const { uuid, name, body, completed, modifiedAt } = reminder;
  const beadsId = (state.reminderUuidToBeadsId || {})[uuid] || null;
  const listName = config.remindersListName;

  // Parse [username] prefix
  const prefixMatch = name.match(PREFIX_RE);
  let assignedUsername = null;
  let titleBase = name;

  if (prefixMatch) {
    assignedUsername = prefixMatch[1].toLowerCase();
    titleBase = name.slice(prefixMatch[0].length);

    // Skip if this belongs to another user we don't know
    const knownUsernames = participants.map(p => p.username);
    if (!knownUsernames.includes(assignedUsername) && assignedUsername !== config.username) {
      // Unknown user prefix — skip (could be someone new; they'll appear after participant refresh)
      return;
    }
  } else {
    // No prefix — belongs to daemon owner
    assignedUsername = config.username;
    titleBase = name;
  }

  const modDate = modifiedAt ? new Date(modifiedAt) : null;
  const lastSyncAt = beadsId ? state.lastSyncAtByBeadsId[beadsId] : null;
  const modifiedSinceCutoff = modDate && modDate > cutoff;
  const isNew = !beadsId;

  // Skip unmodified, already-synced items (but always process new ones).
  // Exception: completed reminders with a beadsId always fall through — we may have
  // missed the close event if the daemon was timing out when the user checked it off.
  if (!isNew && !modifiedSinceCutoff && !(completed && beadsId)) return;

  if (isNew) {
    // New reminder with no Beads link
    if (completed) return; // Completed reminder with no Beads link — ignore

    log(`Creating Beads issue for new reminder: "${titleBase}" → [${assignedUsername}]`);

    const assignee = resolveAssigneeDisplayName(assignedUsername, participants, config);
    const createArgs = [
      `--title "${escapeArg(titleBase)}"`,
      body ? `--description "${escapeArg(body)}"` : '',
      `--labels ${config.syncLabel}`,
      `--type task`,
      assignee ? `--assignee "${escapeArg(assignee)}"` : '',
    ].filter(Boolean).join(' ');

    let newId;
    try {
      const raw = execSync(`bd create ${createArgs} --json`, {
        cwd,
        encoding: 'utf8',
        timeout: 15000,
      });
      const created = JSON.parse(raw);
      newId = Array.isArray(created) ? created[0]?.id : created?.id;
    } catch (e) {
      throw new Error(`bd create failed: ${e.message}`);
    }

    if (!newId) throw new Error('bd create returned no ID');

    // Store Beads ID in state (never written to reminder body)
    if (!state.reminderUuidToBeadsId) state.reminderUuidToBeadsId = {};
    state.reminderUuidToBeadsId[uuid] = newId;
    state.lastSyncAtByBeadsId[newId] = new Date().toISOString();
    log(`Created Beads issue ${newId} for reminder "${titleBase}"`);
    return;
  }

  // Existing Beads link — check if reminder is newer than last sync
  if (!isDefinitelyNewer(modifiedAt, lastSyncAt)) return;

  // Fetch Beads issue
  const issueArr = bdJson(`show ${beadsId}`, cwd);
  const issue = Array.isArray(issueArr) ? issueArr[0] : issueArr;

  if (!issue) {
    // Beads issue was deleted — mark reminder completed as soft-archive
    log(`Beads issue ${beadsId} not found — marking reminder completed`);
    osa.updateReminderCompleted(uuid, listName, true);
    return;
  }

  let changed = false;

  // Completion toggle
  if (completed && issue.status === 'open') {
    log(`Closing Beads issue ${beadsId} (reminder completed)`);
    execSync(`bd close ${beadsId}`, { cwd, encoding: 'utf8', timeout: 15000 });
    changed = true;
  } else if (!completed && issue.status === 'closed') {
    log(`Reopening Beads issue ${beadsId} (reminder unchecked)`);
    execSync(`bd reopen ${beadsId}`, { cwd, encoding: 'utf8', timeout: 15000 });
    changed = true;
  }

  // Title sync
  if (titleBase && titleBase !== issue.title) {
    log(`Updating Beads title for ${beadsId}: "${titleBase}"`);
    execSync(`bd update ${beadsId} --title "${escapeArg(titleBase)}"`, {
      cwd, encoding: 'utf8', timeout: 15000,
    });
    changed = true;
  }

  // Description sync
  if (body !== undefined && body !== (issue.description || '')) {
    log(`Updating Beads description for ${beadsId}`);
    execSync(`bd update ${beadsId} --description "${escapeArg(body)}"`, {
      cwd, encoding: 'utf8', timeout: 15000,
    });
    changed = true;
  }

  if (changed) {
    state.lastSyncAtByBeadsId[beadsId] = new Date().toISOString();
  }
}

function resolveAssigneeDisplayName(username, participants, config) {
  if (username === config.username) return config.displayName || config.username;
  const p = participants.find(p => p.username === username);
  return p ? p.displayName : username;
}

function escapeArg(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

module.exports = { syncRemindersToBeads };
