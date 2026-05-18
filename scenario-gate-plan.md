# Session Handoff: Scenario-Driven Development for Life Organizer

## Context

We compared the Life Organizer's planning documentation against OpenSPEC
(github.com/Fission-AI/OpenSpec), a spec-driven development framework that
enforces a proposal.md / specs/ / design.md / tasks.md structure per feature
before implementation begins.

Verdict: The Life Organizer's architecture documentation (ARD v2, Decision Log,
Open Questions, Secrets Inventory) substantially outperforms what OpenSPEC
generates at the system level. The one genuine gap is OpenSPEC's specs/ output
-- behavioral scenarios in given/when/then format that define acceptance
criteria per feature.

Decision: Don't adopt OpenSPEC. Cherry-pick just the specs/ practice. Add a
lightweight given/when/then scenario block to each claimable Beads issue,
enforced at claim time.


## What Needs to Be Done

Four changes, in order.


## Change 1: Add scenario placeholders to every open non-epic issue

For each of the 17 issues listed below, append this block to the description.
Use bd edit <id> or bd update <id> --description as appropriate.

--- PLACEHOLDER BLOCK (append to description of each issue) ---

## Scenarios

_Fill in before claiming._

- Given [describe initial state]
  When [describe trigger or action]
  Then [describe expected outcome]

--- END PLACEHOLDER BLOCK ---

The 17 issues to update:

  life-4qr  Context Collector v1: Beads + Tasks adapters writing to World State
  life-57m  Design and provision Supabase World State schema
  life-xqz  Deploy Beads Service as persistent cloud endpoint
  life-tm6  Context Reasoner: on-demand Claude recommendations from World State
  life-b45  Rules Engine v1: 4 seed rules evaluating World State
  life-5eu  Calendar Context Collector -- Google Calendar adapter feeding World State
  life-xnb  Email dispatch: Rules Engine -> Resend for high-priority alerts
  life-qlr  Web Push infrastructure: background notifications via service worker
  life-lqn  Conversation Intake Agent: Claude session -> Beads issues and tasks
  life-36d  Corporate Bridge: iCal subscription + email forwarding setup
  life-9br  Email Intake Agent: Gmail parsing -> World State tasks
  life-5xs  Pattern Analyzer: daily Claude call for rule refinement
  life-4ov  Rules-triggered in-app notifications (Notification Dispatcher v1)
  life-86p  Add search across manual tasks
  life-bvk  Mobile layout testing and polish
  life-24a  Calendar view modes: day, work-week, month
  life-d3h  Design and generate real PWA icons

Epics and closed issues are excluded.

Suggested commands (check bd update --help for exact flags):

  bd edit life-4qr
  bd edit life-57m
  bd edit life-xqz
  bd edit life-tm6
  bd edit life-b45
  bd edit life-5eu
  bd edit life-xnb
  bd edit life-qlr
  bd edit life-lqn
  bd edit life-36d
  bd edit life-9br
  bd edit life-5xs
  bd edit life-4ov
  bd edit life-86p
  bd edit life-bvk
  bd edit life-24a
  bd edit life-d3h

After all edits: bd dolt push then git push.


## Change 2: Add pre-commit hook enforcement gate

Edit .beads/hooks/pre-commit. Insert the block below BEFORE the line that reads:
  # --- BEGIN BEADS INTEGRATION v1.0.3 ---

The gate reads the staged issues.jsonl, detects any issue being claimed
(status transitioning to in_progress), and blocks the commit if the Scenarios
section still contains the unfilled placeholder text.

--- BEGIN HOOK BLOCK (insert before BEGIN BEADS INTEGRATION line) ---

# --- BEGIN SCENARIO GATE ---
# Block claiming an issue if its ## Scenarios section has not been filled in.
if git diff --cached --name-only 2>/dev/null | grep -q '\.beads/issues\.jsonl'; then
  python3 - <<'PYEOF'
import json, subprocess, sys

PLACEHOLDER = '_Fill in before claiming._'

def load_jsonl(text):
    issues = {}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            i = json.loads(line)
            issues[i['id']] = i
        except Exception:
            pass
    return issues

r = subprocess.run(['git', 'show', ':0:.beads/issues.jsonl'], capture_output=True, text=True)
if r.returncode != 0:
    sys.exit(0)
staged = load_jsonl(r.stdout)

r2 = subprocess.run(['git', 'show', 'HEAD:.beads/issues.jsonl'], capture_output=True, text=True)
head = load_jsonl(r2.stdout) if r2.returncode == 0 else {}

errors = []
for issue_id, issue in staged.items():
    old_status = head.get(issue_id, {}).get('status', '')
    new_status = issue.get('status', '')
    if new_status == 'in_progress' and old_status != 'in_progress':
        desc = issue.get('description', '')
        if '## Scenarios' not in desc:
            errors.append(f'  {issue_id}: missing ## Scenarios section')
        elif PLACEHOLDER in desc:
            errors.append(f'  {issue_id}: ## Scenarios not filled in -- replace the placeholder before claiming')

if errors:
    print('', file=sys.stderr)
    print('beads: BLOCKED -- fill in Scenarios before claiming:', file=sys.stderr)
    for e in errors:
        print(e, file=sys.stderr)
    print('', file=sys.stderr)
    print('  Add Given/When/Then scenarios to the issue description,', file=sys.stderr)
    print('  then re-run: bd update <id> --claim', file=sys.stderr)
    print('', file=sys.stderr)
    sys.exit(1)
PYEOF
  [ $? -ne 0 ] && exit 1
fi
# --- END SCENARIO GATE ---

--- END HOOK BLOCK ---


## Change 3: Update CLAUDE.md

The Architecture Overview and Conventions & Patterns sections are currently
empty stubs. Replace them with the following.

Find this in CLAUDE.md:

  ## Architecture Overview

  _Add a brief overview of your project architecture_

  ## Conventions & Patterns

  _Add your project-specific conventions here_

Replace with:

  ## Architecture Overview

  Event-driven intelligence system. Specialised agents triggered by a finite
  typed event set, sharing a common World State (Supabase), with Claude invoked
  at exactly three points: Intake parsing, Pattern Analysis, and on-demand
  Context Reasoning. Everything else is a deterministic Rules Engine.

  Full design: .notes/ARD-v2-system-architecture.md
  Stack: React + Vite PWA -> Netlify -> Supabase (World State) -> Railway
  (Beads Service) -> Dolt remote (beads-global sync)

  ## Conventions & Patterns

  ### Scenario-Driven Development

  Every claimable issue (open, non-epic) must have its ## Scenarios section
  filled in BEFORE the issue is claimed. The pre-commit hook enforces this -- a
  claim commit will be blocked if the placeholder text is still present.

  When to fill in: before running bd update <id> --claim. Read the issue
  description, consult ARD v2, write 2-4 scenarios covering the happy path and
  at least one edge or failure case.

  Format:

    ## Scenarios

    - Given [initial state or precondition]
      When [trigger, action, or event]
      Then [expected outcome, including side effects]

    - Given [another context]
      When [action]
      Then [outcome]

  Scope: 2-4 scenarios per issue. Cover the success path, one failure or edge
  case, and any cooldown or deduplication behavior where relevant. Do not write
  exhaustive test suites -- the goal is alignment before implementation, not a
  QA spec.


## Change 4: Update AGENTS.md

In the Quick Reference section, add one line to the workflow commands:

  bd edit <id>   # Edit description to add Scenarios before claiming

In the Rules section, add:

  - Fill in ## Scenarios BEFORE claiming -- the pre-commit hook blocks claims
    with unfilled placeholders. Placeholder text is: _Fill in before claiming._


## Enforcement Logic Summary

  Placeholder text:  _Fill in before claiming._
  Block condition:   issue transitions open -> in_progress AND description
                     contains the placeholder (or has no ## Scenarios section)
  What passes:       any scenario text that replaces the placeholder
  Epics:             exempt -- not directly claimable work items
  Closed issues:     not affected


## Session Close

After completing all four changes:

  bd dolt push
  git add .beads/hooks/pre-commit CLAUDE.md AGENTS.md
  git commit -m "Add scenario-gate: given/when/then required before claiming issues"
  git push
