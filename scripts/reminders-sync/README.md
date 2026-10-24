# Beads ↔ Apple Reminders Sync

Bi-directional sync between a Beads project and a shared iCloud Reminders list. Issues tagged with the sync label appear in Reminders; items created or completed in Reminders flow back into Beads.

The sync targets the **life project** (`/Users/mo/Code/life-organizer`) — synced items land as `life-xxx` issues and flow up to `beads-global` via `bd repo sync`. `beads-global` is an aggregation layer; it receives issues from projects but is not the right origin for personal tasks.

## Setup

```bash
node ~/Code/life-organizer/scripts/reminders-sync/setup.js
```

The setup script is interactive and re-runnable. It auto-detects your node path, Beads identity, and existing Reminders lists; queries the iCloud participants of your chosen list; and lets you confirm or override each person's short username tag. It writes `~/.beads-reminders-config.json`, installs the launchd polling daemon, and optionally runs a test sync.

If interrupted, re-run it — it shows the current state of each step and skips what's already done.

## How it works

Two sync directions with different triggers:

| Direction | Trigger | Latency |
|---|---|---|
| Beads → Reminders | `post-commit` hook after every `bd` write | ~seconds |
| Reminders → Beads | `launchd` polling daemon | ~60 seconds |

A single daemon runs on one Mac (the Beads owner's machine). Other family members interact exclusively through Apple Reminders.

### Sync label

Only Beads issues tagged with the configured `syncLabel` (default: `todo`) sync to Reminders. To opt an issue in:

```bash
bd update <id> --add-label todo
```

To remove it from sync:

```bash
bd update <id> --remove-label todo
```

### Ownership — `[username]` title prefix

Each reminder is prefixed with a short username tag so all participants can see who owns what in the shared list:

```
[mo] Fix the login bug
[alice] Buy birthday cake
```

The daemon creates reminders for all participants, routing each Beads issue to the right person based on its `assignee` field.

Participant names and emails are read automatically from Apple Reminders' local SQLite store (`ZCKSERVERSHAREDATA` in `ZREMCDBASELIST`), which contains a serialized CloudKit `CKShare` record. Setup shows each discovered participant and lets you confirm or override their short tag.

Short tags are auto-derived from the participant's first name (lowercased). Override specific ones in `~/.beads-reminders-config.json`:

```json
{
  "usernameOverrides": {
    "Sarah DiGioia": "sarah"
  }
}
```

At sync time, the participant list is re-read from SQLite on every run, so new participants who join the shared list are picked up automatically — no setup re-run needed.

> **Note:** Apple Reminders' AppleScript API does not expose shared-list participants (the property simply doesn't exist in the scripting dictionary). The SQLite approach reads the same data Reminders uses internally.

### ID mapping

Each synced item is linked in both systems so updates and completions round-trip correctly:

- **Beads side**: `external_ref` field stores `reminders://<UUID>`
- **State file**: `~/.beads-reminders-state.json` maps `reminderUuidToBeadsId: { "<uuid>": "<life-xxx>" }`

The UUID is never written into the reminder body — it lives only in the state file and in Beads' `external_ref`.

### Anti-loop design

A `~/.beads-reminders-state.json` file tracks `lastSyncAtByBeadsId` — when each item was last written by the sync itself. Before propagating a change in either direction, the sync checks whether the modification happened *after* the last sync write (with a 5-second fuzz for clock skew). If not, it skips the item, preventing echo cycles.

```
Beads write → Reminder updated → poll daemon sees reminderModAt ≈ lastSyncAt → skipped ✓
Reminder edit → Beads updated → post-commit sees beadsUpdatedAt ≈ lastSyncAt → skipped ✓
```

### Reads via SQLite, writes via AppleScript

Reading reminders from a shared iCloud list via AppleScript requires the Reminders app to round-trip to iCloud, which can take 30+ seconds and cause ETIMEDOUT on the `spawnSync` call.

`get-reminders.py` reads `ZREMCDREMINDER` directly from the Reminders SQLite store (the same data, locally cached). This is instant regardless of iCloud latency. The AppleScript API is still used for all writes (creating, updating, completing reminders) since the SQLite store is read-only.

### Field mappings

| Reminders field | Beads field | Notes |
|---|---|---|
| Title (after `[username]` prefix) | `title` | 1:1 |
| Notes/body | `description` | 1:1 |
| Completed | `status` (open/closed) | 1:1 |
| Modified date | conflict resolution only | not stored in Beads |
| Due date (`ZDUEDATE`) | `deadline` | ISO date string |
| Priority | `priority` | see mapping table below |
| Tags/hashtags | `labels` | appended alongside `syncLabel` |
| Location | notes passthrough | see below |
| Repeat rule | notes passthrough | see below |

**Priority mapping** (Reminders uses iCal integer encoding):

| Reminders | iCal integer | Beads priority |
|---|---|---|
| None | 0 | 2 (medium/default) |
| High | 1 | 1 |
| Medium | 5 | 2 |
| Low | 9 | 3 |

The reverse (Beads → Reminders): P0/P1 → 1 (high), P2 → 5 (medium), P3/P4 → 9 (low).

**Location and Repeat as passthrough fields:** Beads does not interpret these, but stores them so a round-trip back to Reminders can recreate the original trigger. When present, they are appended to `description` as structured lines:

```
location: 123 Main St
repeat: RRULE:FREQ=WEEKLY;BYDAY=MO
```

The sync strips these lines before displaying the description and re-attaches them when writing back to Reminders, so the geofence trigger and recurrence rule survive the round-trip.

### Deletion behaviour

| Event | Result |
|---|---|
| Beads issue closed | Reminder marked complete |
| Reminder checked off | Beads issue closed |
| Reminder deleted from Reminders | `external_ref` cleared; issue re-created in Reminders on next cycle unless `todo` label is also removed |
| Beads issue deleted | Reminder marked complete (soft archive) |

## Files

```
scripts/reminders-sync/
  get-participants.py            reads CKShare data from Reminders SQLite → JSON participant list
  get-reminders.py               reads ZREMCDREMINDER from Reminders SQLite → JSON reminder list (no AppleScript)
  setup.js                       interactive setup (run once, or re-run to update)
  sync.js                        entry point: --direction=beads-to-reminders|reminders-to-beads|both
  beads-to-reminders.js          Beads → Reminders reconciliation
  reminders-to-beads.js          Reminders → Beads reconciliation
  osascript.js                   AppleScript CRUD helpers (Reminders write operations only)
  state.js                       sync state file R/W (~/.beads-reminders-state.json)
  config.js                      config loader (~/.beads-reminders-config.json)
  config.example.json            config template
  com.beads.reminders-sync.plist launchd plist template (setup installs this)
```

Runtime files (outside the repo, per-user):

```
~/.beads-reminders-config.json   user config (created by setup)
~/.beads-reminders-state.json    sync state (managed by daemon)
~/.beads-reminders-sync.log      Beads→Reminders log (post-commit direction)
/tmp/beads-reminders-sync.log    Reminders→Beads log (launchd direction, cleared on reboot)
~/Library/LaunchAgents/com.beads.reminders-sync.plist  installed by setup
```

## Manual sync

```bash
# Full sync, verbose
node ~/Code/life-organizer/scripts/reminders-sync/sync.js --direction=both --verbose

# One direction only
node ~/Code/life-organizer/scripts/reminders-sync/sync.js --direction=beads-to-reminders
node ~/Code/life-organizer/scripts/reminders-sync/sync.js --direction=reminders-to-beads
```

## Daemon management

```bash
# Check daemon status
launchctl list com.beads.reminders-sync

# Reload after config changes
launchctl unload ~/Library/LaunchAgents/com.beads.reminders-sync.plist
launchctl load   ~/Library/LaunchAgents/com.beads.reminders-sync.plist
```

## Adding a new participant

When someone joins the shared iCloud list, they are discovered automatically on the next sync cycle and assigned a username from their first name. To verify or override their tag, re-run setup:

```bash
node ~/Code/life-organizer/scripts/reminders-sync/setup.js
```

The status check at the top will show everything already configured; only the participant confirmation step needs attention.

## Design decisions

**Why the `life` project, not `beads-global`?**  
`beads-global` is an aggregation layer — it syncs issues *from* individual projects via `bd repo sync`. Having Reminders items originate there would mean they never go through a project, which breaks the project → global hierarchy and makes them invisible in the life project's own dashboard. The life project (`/Users/mo/Code/life-organizer`) is the correct semantic home for personal tasks.

**Why SQLite for reads?**  
The Reminders AppleScript API requires the app to answer, and for shared iCloud lists the app waits for an iCloud round-trip before responding. On a slow or busy iCloud connection this exceeds the 30s `spawnSync` timeout and kills the osascript process. Reading `ZREMCDREMINDER` from the SQLite store is instant and uses the same locally cached data. Writes still go through AppleScript since the SQLite store is read-only from outside the app.

**Why store location/repeat as passthrough rather than ignoring them?**  
Beads cannot fire a geofence trigger or repeat a task. But if the location string is preserved through the round-trip, a future "recreate reminder from Beads issue" path can write it back and the Reminders app will reconstitute the geofence. Ignoring the field would mean the data is lost after the first sync; storing it as a structured passthrough line keeps it available without Beads needing to understand it.

**Why use Reminders' own priority language rather than Beads' P0–P4?**  
Reminders uses None/Low/Medium/High (iCal integers 0/9/5/1). Forcing P1/P2 labels onto Reminders items would mean every family member sees unfamiliar Beads vocabulary in their Reminders app. The mapping table converts between the two systems transparently — each side sees its own language.
