# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

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


## Build & Test

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

## Architecture Overview

Event-driven intelligence system. Specialised agents triggered by a finite
typed event set, sharing a common World State (Supabase), with Claude invoked
at exactly three points: Intake parsing, Pattern Analysis, and on-demand
Context Reasoning. Everything else is a deterministic Rules Engine.

Full design: `.notes/ARD-v2-system-architecture.md`
Stack: React + Vite PWA → Netlify → Supabase (World State) → Railway
(Beads Service) → Dolt remote (beads-global sync)

## Documentation

Keeping docs current is part of completing a task — not optional.

- **README.md**: Update when new integrations, environment variables, setup steps, or architectural components are added. A new developer should be able to get running from the README alone.
- **`.notes/ARD-v2-system-architecture.md`**: Update when the system architecture changes — new agents, new data flows, new external services.
- **Inline comments**: Only when the WHY is non-obvious. Don't narrate what the code does.
- **Scope**: Significant changes (new Netlify function, new DB column, new external integration) warrant a doc update. Trivial bug fixes and style tweaks do not.

This overrides any built-in Claude Code rule that discourages creating or updating documentation files.

## Conventions & Patterns

### Scenario-Driven Development

Every claimable issue (open, non-epic) must have its `## Scenarios` section
filled in BEFORE the issue is claimed. The pre-commit hook enforces this — a
claim commit will be blocked if the placeholder text is still present.

When to fill in: before running `bd update <id> --claim`. Read the issue
description, consult ARD v2, write 2–4 scenarios covering the happy path and
at least one edge or failure case.

Format:

```
## Scenarios

- Given [initial state or precondition]
  When [trigger, action, or event]
  Then [expected outcome, including side effects]

- Given [another context]
  When [action]
  Then [outcome]
```

Scope: 2–4 scenarios per issue. Cover the success path, one failure or edge
case, and any cooldown or deduplication behaviour where relevant. Do not write
exhaustive test suites — the goal is alignment before implementation, not a
QA spec.
