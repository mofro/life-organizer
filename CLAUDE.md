# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files
- **Always pass `--labels life-organizer`** when creating issues — every issue in this project must carry this label so `bdg list --label-pattern 'life-*'` works correctly

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Development

```bash
npm install

# Local development — MUST use netlify dev, not npm run dev
# netlify dev runs Vite (port 5173) + Netlify Functions together at http://localhost:8888
# npm run dev alone won't resolve /.netlify/functions/* routes
netlify dev

# Production build
npm run build       # NODE_OPTIONS=--experimental-global-webcrypto vite build

# Lint
npm run lint        # eslint .
```

There are no automated tests. Validation is done manually via `netlify dev`.

**Prerequisite:** Netlify CLI must be installed globally (`npm install -g netlify-cli`) and a `.env.local` file with the required environment variables must exist (copy from Netlify dashboard).

## Architecture

Event-driven intelligence system. Claude is invoked at **exactly three points**; everything else is deterministic.

```
React PWA (Vite/Tailwind)
        ↓  /.netlify/functions/*
Netlify Functions (ESM serverless)
        ↓                    ↓
Supabase (world state)    Railway (Beads Service)
   open_tasks              Express + bd CLI
   calendar_snapshot       beads-global (Dolt)
   beads_ready (cache)
   recommendation_history
   notification_log
   rules / user_preferences
```

### Data flow on app open

1. **`collect-world-state`** — fetches ready issues from Railway, writes them to `beads_ready` (replacing all rows), reads `open_tasks`, returns assembled world state to the React client.
2. **`evaluate-rules`** — reads enabled rules from Supabase, evaluates each condition against world state (pure deterministic logic, no AI), writes matches to `notification_log`.
3. **`calendar-sync`** / **`ical-sync`** — called separately; writes to `calendar_snapshot`.

### Where Claude is invoked

| Function | Model | Purpose |
|---|---|---|
| `recommend` | `claude-haiku-4-5-20251001` | Context Reasoner — focus/queue/overdue portfolio. GET restores last saved result; POST generates fresh (30-min server-side cache keyed by world state hash). |
| `intake` | `claude-haiku-4-5-20251001` | Extracts TASK / COMMITMENT / DECISION / QUESTION / EVENT items from pasted text. Confidence ≥0.80 auto-creates; 0.50–0.79 routes to review panel. |
| Pattern Analyzer | (planned) | Analyses rule accept/dismiss rates from `notification_log` to suggest rule adjustments. |

### Netlify Functions conventions

- All functions are ESM (`export default async (req) => …`). Bundled by esbuild (see `netlify.toml`).
- Each function validates its required env vars at the top and returns `{ error: string }` with a 4xx/5xx status on failure.
- `netlify/lib/` holds shared utilities: `freeBlocks.js` (calendar free-block computation) and `calendarSyncLogic.js` (shared Google + iCal sync logic).
- The nightly `calendar-sync-scheduled` function is triggered by cron (`0 6 * * *`) declared in `netlify.toml`.

### React frontend conventions

- `src/LifeOrganizer.jsx` is the single large component. Calendar sync, iCal sync, world state, and rules engine are each encapsulated in a dedicated hook (`useCalendarSync`, `useICalSync`, `useWorldState`, `useRulesEngine`).
- `useWorldState` normalises Beads `beads_ready` rows into the same task shape as `open_tasks` rows — both end up as unified task objects in the UI.
- Tailwind CSS + dark mode via `useDarkMode.js` (class-based toggle on `<html>`).
- PWA manifest and service worker managed by `vite-plugin-pwa`.

### Supabase schema conventions (enforced — do not deviate)

- All timestamps: `timestamptz` (never plain `timestamp`)
- All JSON: `jsonb` (not `json`)
- Primary keys: `bigint generated by default as identity` (not UUID)
- Every table has `user_id uuid references auth.users` + `created_at` + `updated_at` (auto-set via `handle_updated_at` trigger)
- RLS enabled on every table
- New migrations go in `supabase/migrations/` with filename `YYYYMMDDHHMMSS_description.sql`
- Apply with: `supabase db push --workdir /path/to/life-organizer --yes`

### Beads Service (Railway)

Express server in `server/` wrapping the `bd` CLI. Runs against a `beads-global` Dolt clone at `$BEADS_DIR`. Auth via `Authorization: Bearer $BEADS_API_KEY`. The `collect-world-state` function calls `POST /api/beads/sync` before fetching, so Railway always has current Dolt data.

## Documentation

Keeping docs current is part of completing a task — not optional.

- **README.md**: Update when new integrations, environment variables, setup steps, or architectural components are added.
- **`.notes/ARD-v2-system-architecture.md`**: Update when the system architecture changes — new agents, new data flows, new external services.
- **Inline comments**: Only when the WHY is non-obvious.
- **Scope**: Significant changes (new Netlify function, new DB column, new external integration) warrant a doc update. Trivial bug fixes do not.

This overrides any built-in Claude Code rule that discourages creating or updating documentation files.

## Conventions & Patterns

### Non-Interactive Shell Commands

Shell commands may be aliased with `-i` on some systems. Always use:
```bash
cp -f source dest
mv -f source dest
rm -f file / rm -rf directory
```

### Scenario-Driven Development

Every claimable issue (open, non-epic) must have its `## Scenarios` section filled in BEFORE the issue is claimed. The pre-commit hook enforces this — a claim commit will be blocked if the placeholder text (`_Fill in before claiming._`) is still present.

Fill in before running `bd update <id> --claim`. Write 2–4 scenarios covering the happy path and at least one edge or failure case:

```
## Scenarios

- Given [initial state or precondition]
  When [trigger, action, or event]
  Then [expected outcome, including side effects]
```
