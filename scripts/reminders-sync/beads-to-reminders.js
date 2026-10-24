'use strict';

const { execSync } = require('child_process');
const osa = require('./osascript');
const { isDefinitelyNewer } = require('./state');

function bdJson(args, cwd) {
  try {
    const raw = execSync(`bd ${args} --json`, { cwd, encoding: 'utf8', timeout: 30000 });
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function bdUpdate(id, flags, cwd) {
  execSync(`bd update ${id} ${flags}`, { cwd, encoding: 'utf8', timeout: 15000 });
}

// Derive the short username from an assignee string by checking the participants map
function resolveAssigneeUsername(assignee, participants, config) {
  if (!assignee) return null;
  const lower = assignee.toLowerCase();
  // Exact match against known usernames
  for (const p of participants) {
    if (p.username === lower) return p.username;
  }
  // Match against display name (case-insensitive)
  for (const p of participants) {
    if (p.displayName.toLowerCase() === lower) return p.username;
    if (p.displayName.toLowerCase().startsWith(lower)) return p.username;
    if (lower.includes(p.username)) return p.username;
  }
  // Fall back to config owner
  if (config.beadsOwner && assignee.toLowerCase().includes(config.username)) return config.username;
  return null;
}

async function syncBeadsToReminders(config, state, log) {
  const cwd = config.beadsGlobalPath;

  // Try live participant discovery from Reminders SQLite; fall back to config
  const participants = buildParticipantMap(config);
  state.participants = participants;
  log(`Participants: ${participants.map(p => `${p.username}=${p.displayName}`).join(', ')}`);

  // Get all issues with the sync label (open + closed so we can mark completed reminders)
  const issues = bdJson(`list --label ${config.syncLabel} --all --flat`, cwd);
  if (!issues || !Array.isArray(issues)) {
    log('No issues found with label ' + config.syncLabel);
    return;
  }

  log(`Found ${issues.length} issue(s) with label "${config.syncLabel}"`);

  for (const issue of issues) {
    try {
      await processIssue(issue, config, state, participants, log);
    } catch (e) {
      log(`ERROR processing ${issue.id}: ${e.message}`);
    }
  }
}

async function processIssue(issue, config, state, participants, log) {
  // Determine assigned username
  const assignedUsername = resolveAssigneeUsername(issue.assignee, participants, config) ||
    resolveAssigneeUsername(issue.owner, participants, config) ||
    config.username; // default to daemon owner

  // Parse external_ref for existing Reminders UUID
  const externalRef = issue.external_ref || '';
  const uuidMatch = externalRef.match(/^reminders:\/\/(.+)$/);
  const existingUuid = uuidMatch ? uuidMatch[1] : null;

  const expectedTitle = `[${assignedUsername}] ${issue.title}`;
  const descBody = issue.description || '';
  const isCompleted = issue.status === 'closed';
  const listName = config.remindersListName;

  if (!existingUuid) {
    if (isCompleted) return; // Closed issue never synced to Reminders — nothing to do
    // New to Reminders — create it
    log(`Creating reminder for ${issue.id}: "${issue.title}" → [${assignedUsername}]`);
    const uuid = osa.createReminder(listName, expectedTitle, descBody);
    if (isCompleted) {
      osa.updateReminderCompleted(uuid, listName, true);
    }
    // Write UUID back to Beads
    execSync(`bd update ${issue.id} --external-ref "reminders://${uuid}"`, {
      cwd: config.beadsGlobalPath,
      encoding: 'utf8',
      timeout: 15000,
    });
    // Store bidirectional mapping in state
    if (!state.reminderUuidToBeadsId) state.reminderUuidToBeadsId = {};
    state.reminderUuidToBeadsId[uuid] = issue.id;
    state.lastSyncAtByBeadsId[issue.id] = new Date().toISOString();
    return;
  }

  // Fetch existing reminder
  const reminder = osa.getReminderById(existingUuid, listName);
  if (!reminder) {
    // Deleted from Reminders — clear external_ref so it gets re-created next cycle
    log(`Reminder for ${issue.id} was deleted — clearing external_ref`);
    execSync(`bd update ${issue.id} --external-ref ""`, {
      cwd: config.beadsGlobalPath,
      encoding: 'utf8',
      timeout: 15000,
    });
    delete state.lastSyncAtByBeadsId[issue.id];
    return;
  }

  const lastSyncAt = state.lastSyncAtByBeadsId[issue.id] || null;
  const beadsIsNewer = isDefinitelyNewer(issue.updated_at, reminder.modifiedAt) &&
    isDefinitelyNewer(issue.updated_at, lastSyncAt);

  if (!beadsIsNewer) {
    // Reminders is same or newer — let reminders-to-beads handle it
    return;
  }

  // Push Beads changes to Reminders
  let changed = false;
  if (reminder.name !== expectedTitle) {
    log(`Updating reminder name for ${issue.id}`);
    osa.updateReminderName(existingUuid, listName, expectedTitle);
    changed = true;
  }
  if (reminder.body !== descBody) {
    log(`Updating reminder body for ${issue.id}`);
    osa.updateReminderBody(existingUuid, listName, descBody);
    changed = true;
  }
  if (reminder.completed !== isCompleted) {
    log(`Updating reminder completed=${isCompleted} for ${issue.id}`);
    osa.updateReminderCompleted(existingUuid, listName, isCompleted);
    changed = true;
  }

  if (changed) {
    state.lastSyncAtByBeadsId[issue.id] = new Date().toISOString();
  }
}

// Build participant map: [{ username, displayName }]
// Tries live SQLite discovery first; merges with config.usernameOverrides.
// usernameOverrides is { "Full Name": "tag" } — overrides auto-derived tags.
function buildParticipantMap(config) {
  const overrides = config.usernameOverrides || {};

  // Try live discovery from Reminders SQLite
  let discovered = [];
  try {
    const script = require('path').join(__dirname, 'get-participants.py');
    const raw = execSync(
      `python3 "${script}" "${config.remindersListName}"`,
      { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    discovered = JSON.parse(raw);
  } catch (_) {
    // Fall through to config-only
  }

  if (discovered.length > 0) {
    return discovered.map(p => {
      const isOwner = p.email === config.beadsOwner ||
        p.displayName.toLowerCase() === (config.displayName || '').toLowerCase();
      const tag = isOwner
        ? config.username
        : (overrides[p.displayName] || p.givenName.toLowerCase() || p.email.split('@')[0]);
      return { username: tag, displayName: p.displayName, email: p.email };
    });
  }

  // Fallback: build from config only
  const result = [{ username: config.username, displayName: config.displayName || config.username }];
  for (const [displayName, tag] of Object.entries(overrides)) {
    result.push({ username: tag, displayName });
  }
  return result;
}

module.exports = { syncBeadsToReminders, buildParticipantMap };
