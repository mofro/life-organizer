# Architecture Requirements Document v2
# Intelligent Life Organizer — System Architecture

**Document Version:** 2.0
**Date:** May 17, 2026
**Author:** Mo (with Claude Sonnet 4.5)
**Status:** Active — supersedes ARD v1 (2026-05-16)

> **Why v2?** The v1 ARD was written before implementation began and assumed a Claude.ai
> artifact deployment model. Decision 6 (local Vite + Netlify PWA) changed the foundation,
> but the integration and intelligence sections were never updated. A deeper architectural
> design session produced a fundamentally different system characterisation that supersedes
> the original integration strategy.
>
> **v1 is preserved** at `ARD-life-organizer.md` as a historical record of the project's
> origin discussion, requirements evolution, and initial decisions (1–8).

---

## Table of Contents

1. [The Three Tensions](#the-three-tensions)
2. [System Characterisation](#system-characterisation)
3. [Event Bus — The Finite Input Set](#event-bus)
4. [Full System Diagram](#full-system-diagram)
5. [Agent Catalog](#agent-catalog)
6. [The Beads-as-a-Service Resolution](#beads-as-a-service)
7. [Corporate Walled Garden — Pragmatic Ceiling](#corporate-walled-garden)
8. [Conversation as Work Stream](#conversation-as-work-stream)
9. [Rules Engine Pattern](#rules-engine-pattern)
10. [Where Claude Actually Belongs](#where-claude-belongs)
11. [Implementation Sequence](#implementation-sequence)
12. [Decision Log (Decisions 9–12)](#decision-log)
13. [Open Questions](#open-questions)

---

## The Three Tensions

The v1 architecture hit three fundamental tensions that drove this redesign:

### 1. Personal Context Problem

Some data sources are local (Beads CLI on the developer's machine, tasks in
`localStorage`). Others are cloud services (Google Calendar, Gmail). No single
runtime had reach to all of them simultaneously. Building integrations on either
side left the other blind.

### 2. Agency Problem

The local side has the data but can't act in the background — no cron jobs, no push
notifications, no "while you're asleep" intelligence. The cloud side can act in the
background but can't see local data without a sync layer. Each half of the system
is incomplete without the other.

### 3. Data Assembly Problem

Even with the right runtime and the right data access, someone has to gather tasks +
calendar events + Beads issues and package them into coherent context for Claude. That
orchestration step is non-trivial regardless of where it runs. It was the missing piece
in both the "local-first" and "cloud-first" framings.

---

## System Characterisation

This system is **not**:
- A classic ReAct agentic loop (overkill — the task is well-scoped, not open-ended)
- A fixed-pipeline agentic graph (implies chained agents; these are loosely coupled via shared state)
- A continuous monitoring system (intelligence fires at discrete collection points, not always)

This system **is**:

> **Event-driven intelligence: specialised agents triggered by a finite, typed set of
> events, sharing a common World State, with AI invoked at exactly three specific
> decision points — and nowhere else.**

| Pattern considered | Verdict |
|---|---|
| Classic agentic flow (ReAct loop) | ❌ Overkill — task is well-scoped, not open-ended reasoning |
| Agentic graph (LangGraph-style) | ⚠️ Close, but implies fixed pipeline; agents here are loosely coupled via shared state, not chained |
| Multi-agent + shared world state | ✅ Correct — specialised agents, independent trigger conditions, common context store |
| Event-driven intelligence | ✅ Best label — event bus determines *when* reasoning happens; AI only at decision nodes |

The architecture is **primarily deterministic**. A rules engine evaluates finite, typed
events against a structured world state. The "intelligence" is in the rules themselves —
and Claude's job is to *improve the rules periodically*, not to run the system on every
event.

---

## Event Bus

The set of events that can change world state is **finite and enumerable**. This is
not open-ended discovery — it's a state machine with a bounded input alphabet.

```
SCHEDULE EVENTS
  • Cron tick (6am briefing, noon check, 5pm wrap — configurable)
  • Time elapsed since last recommendation

CALENDAR EVENTS
  • Event created / modified / cancelled
  • Event ending → sudden free block opened
  • Day boundary crossed (tomorrow becomes today)

WORK EVENTS
  • Beads issue: created / claimed / closed / unblocked
  • Manual task: added / completed / deadline changed
  • GitHub: PR merged, action completed, deploy succeeded
  • External: webhook from any registered source

USER EVENTS
  • App opened
  • Recommendation accepted / dismissed / snoozed
  • Manual refresh requested
```

Everything that could change the world state flows through one of these buckets.
When an event fires, the Rules Engine evaluates current world state against its rule
set. This is fast, cheap, and deterministic.

---

## Full System Diagram

```
╔══════════════════════════════════════════════════════════════════════╗
║               EXTERNAL SIGNALS (unstructured, ambiguous)            ║
║                                                                      ║
║  Gmail (personal) ─────────────────────────────────────────────┐   ║
║  Corporate iCal URL ───────────────────────────────────────────┤   ║
║  Corporate email (forwarded) ──────────────────────────────────┤   ║
║  Claude conversation ──────────────────────────────────────────┤→  ║
║  Notes / voice capture ────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════╤══════════════════╝
                                                   │
                                                   ▼
╔══════════════════════════════════════════════════════════════════════╗
║              INTAKE AGENTS  (Claude-powered, per-event)             ║
║                                                                      ║
║  Email Intake · Corporate Bridge · Conversation Intake              ║
║                                                                      ║
║  Classify → Extract → Confidence-gate → World State update          ║
╚══════════════════════════════════════════════════╤══════════════════╝
                                                   │
           ┌───────────────────────────────────────┘
           │
╔══════════╧═══════════════════════════════════════════════════════════╗
║              KNOWN STRUCTURED SOURCES                               ║
║                                                                      ║
║  Beads Service (deployed, Dolt-synced) ───────────────────────┐    ║
║  Google Calendar (OAuth) ─────────────────────────────────────┤→   ║
║  Task Store (Supabase) ───────────────────────────────────────┘    ║
║                                                                      ║
║                         CONTEXT COLLECTOR assembles WorldState      ║
╚══════════════════════════════════════════════════╤══════════════════╝
                                                   │
                                                   ▼
╔══════════════════════════════════════════════════════════════════════╗
║                    WORLD STATE  (Supabase)                          ║
║                                                                      ║
║  calendar_snapshot | open_tasks | beads_ready | rules | patterns   ║
║  recommendation_history | notification_log | user_preferences       ║
╚══════════╤════════════════════════════════════╤═════════════════════╝
           │                                    │
           │ FAST (every state change)          │ SLOW (daily/weekly)
           ▼                                    ▼
╔══════════════════════════╗        ╔══════════════════════════════════╗
║   RULES ENGINE           ║        ║   PATTERN ANALYZER  (Claude)    ║
║   (deterministic)        ║        ║                                 ║
║                          ║        ║  Reviews: what fired, outcomes  ║
║   IF state matches rule  ║        ║  Suggests: rule adjustments     ║
║   AND priority ≥ thresh  ║        ║  Updates: rule set in Supabase  ║
║   AND not in cooldown    ║        ║                                 ║
║   THEN → fire            ║        ║  Once/day. One Claude call.     ║
╚══════════╤═══════════════╝        ╚══════════════════════════════════╝
           │
           ▼
╔══════════════════════════════════════════════════════════════════════╗
║              NOTIFICATION DISPATCHER                                ║
║                                                                      ║
║   Push | Email | In-app  ←  rule match + context payload           ║
╚══════════════════════════════════════════════════════════════════════╝

           │  ON-DEMAND (user-triggered)
           ▼
╔══════════════════════════════════════════════════════════════════════╗
║              CONTEXT REASONER  (Claude)                             ║
║                                                                      ║
║   Full world state → rich recommendations + explanations            ║
║   "What should I work on right now, and why?"                       ║
╚══════════════════════════════════════════════════════════════════════╝
                                                   │
                                                   ▼
╔══════════════════════════════════════════════════════════════════════╗
║                          PWA / UI                                   ║
║                                                                      ║
║   Shows recommendations | Accepts actions | Feeds events back       ║
║   Works offline from cached World State                             ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Agent Catalog

Eight agents in total. Four are deterministic (no AI cost). Four use Claude (bounded,
justified, non-redundant).

| Agent | Trigger | AI? | Cost profile | Role |
|---|---|---|---|---|
| **Email Intake** | New email arrives | ✅ Claude | Per intake event | Parse unstructured email → task/event/discard |
| **Corporate Bridge** | iCal poll / forwarded email | ⚠️ Partial | Near-zero | Read-only calendar + selective email capture |
| **Conversation Intake** | User invokes or session close | ✅ Claude | On-demand | Extract tasks/decisions from conversation |
| **Context Collector** | Every event trigger | ❌ Rules | Free | Assemble WorldState from structured sources |
| **Rules Engine** | Every state change | ❌ Rules | Free | Evaluate conditions → fire notifications |
| **Pattern Analyzer** | Daily/weekly cron | ✅ Claude | 1 call/cycle | Review rule outcomes → refine rule set |
| **Context Reasoner** | User-triggered | ✅ Claude | Per request | WorldState → ranked recommendations + explanations |
| **Notification Dispatcher** | Rules Engine output | ❌ Rules | Free | Route to push / email / in-app |

### Where Claude Is Irreplaceable vs. Where It Isn't

**Claude is irreplaceable for:**
- Understanding natural language (email parsing, conversation extraction)
- Meta-reasoning about system behaviour (rule refinement)
- Synthesis under uncertainty (rich context-aware recommendations)

**Rules handle everything else:**
- Deadline proximity detection
- Free-block matching
- Notification deduplication
- Event classification (by source type, not content)
- Recommendation display and user action handling

The 95% case (deadline in 24h → send alert) never needs Claude. Claude is justified
for: implicit requests buried in prose ("could you take a look before Friday?"),
complex contextual matches (cancelled meeting + blocked Beads issue just unblocked),
and rule refinement from observed patterns.

---

## Beads-as-a-Service

**The original claim:** "Beads is irreducibly local — the `bd` CLI only runs where
it's installed."

**Why that's wrong:** Beads uses Dolt as its storage engine. Dolt is a MySQL-compatible,
git-versioned SQL database with native remote sync (`bd dolt push / bd dolt pull`).
The `~/beads-global` directory is just a local checkout of a Dolt repo — structurally
identical to a git working directory.

**The resolution:**

```
LOCAL MACHINE:
  bd CLI
    → beads-global (Dolt, local checkout)
    → bd dolt push (on close/claim, or scheduled)
    → Dolt Remote (DoltHub, or self-hosted Dolt server)

CLOUD:
  Dolt Remote
    ← pulled by Deployed Beads Service
  Deployed Beads Service (same server/index.js, on Railway/Render/Fly)
    ← called by Netlify functions, Context Collector, Rules Engine
```

The existing `server/index.js` is already the correct abstraction — an Express HTTP
wrapper around `bd` CLI calls. Deploy it with Dolt remote sync configured, and the
local/cloud divide collapses.

**Write operations** (claim, close) flow through the deployed service → Dolt remote →
`bd dolt pull` keeps local copy current. This is a coherent sync model: local is the
primary, cloud is a read-replica with write-back.

**The division point is the Dolt remote, not the local machine.**

---

## Corporate Walled Garden — Pragmatic Ceiling

Full Exchange/Outlook integration (Microsoft Graph API) requires:
- IT approval
- Corporate OAuth tenant registration
- Ongoing security review

This is a permission problem, not an architecture problem. Out of scope for a personal
tool.

**What IS accessible without IT:**

```
iCal URL subscription
  Most Exchange/Outlook deployments let users publish a read-only iCal
  URL (Outlook → Settings → Calendar → Shared calendars → Publish).
  No OAuth. No IT. Provides: events, free/busy, meeting titles.
  Sufficient for scheduling context.

Email forwarding rules
  User sets up Outlook rules: specific senders or subject patterns →
  forward to personal Gmail. Gmail Intake Agent picks them up.
  User controls scope entirely. IT doesn't need to know.

Conversation capture (explicit)
  Manual path for work context: "I just got asked to lead the Q3 review,
  add that as a task." Conversation Intake Agent handles it.
```

**Design ceiling:** treat work calendar as a read-only subscription. Do not build
toward write operations or deep corporate integration. Architect the system to work
well within this ceiling, not around it.

---

## Conversation as Work Stream

This is already happening implicitly:
- This ARD was generated from a Claude conversation
- Beads issues were created from Claude sessions
- `bd remember` is a primitive version of conversation capture

**What the architecture formalises:**

```
Conversation (with Claude or solo journaling)
  → Conversation Intake Agent (Claude)
  → Extract: commitments, tasks, decisions, open questions
  → Confidence-gate:
      high confidence → create Beads issue / task directly
      low confidence → surface to user for confirmation
  → Output: Beads issues created, World State updated
```

**Source determines destination** (no manual labelling required):
- Work brainstorming conversation → work project Beads issues
- Personal planning conversation → life tasks in Supabase
- Mixed conversation → user disambiguates at confidence-gate

This closes the loop between thinking and doing. Claude is already in the workflow;
the architecture just makes the capture explicit and automatic.

---

## Rules Engine Pattern

The Rules Engine is the heart of the system's day-to-day intelligence. It is
**entirely deterministic** — no AI involvement, no variable cost, no latency.

### Rule Structure

```
IF   world_state matches condition_set
AND  priority_score >= threshold
AND  NOT already_notified_within(cooldown_period)
THEN fire(notification_type, context_payload)
```

### Seed Rule Set (v1)

```
RULE: open-block-match
  IF   free_block.duration >= task.time_required
  AND  task.priority IN ('high', 'critical')
  AND  task.status == 'pending'
  THEN → "You have {duration} free — {task.title} fits"
  cooldown: 2h

RULE: deadline-proximity
  IF   task.deadline - now <= 24h
  AND  task.status != 'completed'
  THEN → "Deadline tomorrow: {task.title}"
  cooldown: 12h

RULE: beads-unblocked
  IF   beads_issue.blocked_by.all_closed == true
  AND  beads_issue.priority <= P1
  THEN → "{issue.id} is now unblocked and ready to claim"
  cooldown: 24h

RULE: stalled-deadline
  IF   days_since_any_progress(task) >= 3
  AND  task.deadline - now <= 7 days
  THEN → "{task.title} has stalled — {days_left} days left"
  cooldown: 48h
```

### Rule Lifecycle

Rules are stored in Supabase alongside their firing history (when fired, what user
did — accepted, dismissed, snoozed). The Pattern Analyzer reviews this history on a
daily/weekly cadence and suggests adjustments:

```
Pattern Analyzer inputs:
  • rules table (current rule set)
  • notification_log (what fired, when)
  • user_actions (accepted / dismissed / snoozed, with timestamps)

Pattern Analyzer outputs:
  • threshold adjustments (this rule fires too often → raise threshold)
  • new rule candidates (I notice you always act on X after Y — formalise that)
  • rule deprecation candidates (this rule has 0% acceptance rate → disable?)

User approves or auto-applies (configurable confidence threshold)
```

Rules are the **executable memory of learned behaviour**. The Pattern Analyzer is
what makes them improve over time. Claude's job is to write better rules, not to run
the ones that already exist.

---

## Where Claude Belongs

Three roles, each distinct and justified:

### 1. Intake Agents — Claude as Parser

**When:** New unstructured input arrives (email, conversation, document)
**Task:** Convert ambiguous natural language to structured world state
**Why Claude:** Rules cannot do NLP. "Could you take a look before Friday?" has no
parseable deadline. Claude identifies the implicit ask, estimates urgency from sender
context and project relationship, and creates a task with appropriate confidence score.
**Cost:** Bounded by input event frequency. Personal email volume is manageable.

### 2. Pattern Analyzer — Claude as Rule-Writer

**When:** Daily or weekly cron fires
**Task:** Review rule firing history + user responses → suggest rule improvements
**Why Claude:** Meta-reasoning about system behaviour. Identifying that "this rule fires
at 9am but you never act on it until noon" requires pattern recognition across time
series data, not a deterministic rule.
**Cost:** One call per cycle. Predictable and low.

### 3. Context Reasoner — Claude as Advisor

**When:** User explicitly asks "what should I work on right now?"
**Task:** Full world state → rich ranked recommendations with explanations
**Why Claude:** Synthesis under uncertainty with explanation. Not just "task A scores
higher than task B" but "given your 3pm meeting and the deploy that just finished,
here's the 90-minute window that makes this the right moment for task A."
**Cost:** Per-request, user-initiated. Worth it because the user asked.

---

## Implementation Sequence

The old sequence was feature-driven. The correct sequence is infrastructure-first —
each layer depends on the one below it.

```
PHASE 1: FOUNDATION
  1a. Configure Dolt remote for beads-global
      → enables local/cloud sync, unblocks deployed Beads Service
  1b. Deploy Beads Service (server/index.js on Railway/Render/Fly)
      → cloud functions can now read Beads data
  1c. Design + provision Supabase World State schema
      → shared context store: tasks, rules, notifications, patterns, calendar_snapshot
  1d. Context Collector v1 (Beads + Tasks adapters → World State)
      → first real data in the store

PHASE 2: FIRST INTELLIGENCE
  2a. Rules Engine v1 — implement 4 seed rules
      → first deterministic intelligence firing against real world state
  2b. Calendar adapter (life-5eu revised — feeds Context Collector)
      → world state now includes calendar context
  2c. Notification Dispatcher — in-app + email routing
      → rules can now reach the user

PHASE 3: INTAKE
  3a. Email Intake Agent (Gmail → classify → extract → World State)
  3b. Corporate Bridge (iCal subscription + optional forwarding)
  3c. Conversation Intake Agent (Claude session → Beads issues)

PHASE 4: LEARNING
  4a. Pattern Analyzer — daily Claude call, rule refinement
  4b. Context Reasoner — on-demand Claude call, full recommendations
  4c. Web Push infrastructure (service worker + VAPID)

PHASE 5: POLISH
  5a. Search (life-86p)
  5b. Mobile layout (life-bvk)
  5c. Real PWA icons (life-d3h)
  5d. Calendar view modes (life-24a)
```

---

## Decision Log

*Decisions 1–8 are in ARD v1. This log continues from Decision 9.*

### Decision 9: Dolt Remote as the Local/Cloud Sync Point

**Date:** 2026-05-17
**Decision:** Use Dolt's native remote sync (`bd dolt push / bd dolt pull`) as the
bridge between local Beads state and cloud-accessible Beads state. Deploy `server/index.js`
as a persistent Beads Service; configure a Dolt remote so local `bd` work auto-syncs.
**Rationale:** Beads is not irreducibly local. Dolt is a git-versioned SQL database
with native remote support — structurally analogous to a git repo with a GitHub remote.
The existing Express wrapper (`server/index.js`) is already the right abstraction;
deploying it eliminates the local/cloud divide without building a separate datastore
or Beads adapter.
**Alternatives rejected:**
- Supabase as Beads mirror (requires custom sync logic, duplicates data, loses Dolt's
  versioning and dependency graph)
- Periodic JSON export (fragile, eventually inconsistent)
**Status:** Approved 2026-05-17.

---

### Decision 10: Rules Engine First, AI at Decision Nodes

**Date:** 2026-05-17
**Decision:** The core operational system is a deterministic rules engine. AI (Claude)
is invoked at exactly three points: Intake parsing, Pattern Analysis (rule refinement),
and on-demand Context Reasoning. Not on every event, not on every notification, not
continuously.
**Rationale:** Rules are fast, cheap, and predictable. The 95% case (deadline proximity,
free-block matching, unblocked task alert) does not require natural language understanding
or probabilistic reasoning. Inserting Claude into the fast path adds cost, latency, and
failure modes without adding value. Claude's comparative advantage is at the boundaries:
parsing unstructured inputs, reasoning about patterns across time, and explaining complex
trade-offs on demand.
**Alternatives rejected:**
- Claude on every notification (cost, latency, overkill for deterministic conditions)
- Pure rules without AI (can't parse email, can't learn, can't explain reasoning)
**Status:** Approved 2026-05-17.

---

### Decision 11: Intake Layer as a First-Class Architectural Concern

**Date:** 2026-05-17
**Decision:** Email, corporate signals, and conversations are first-class input channels,
not edge cases. A dedicated Intake Layer (separate from the Context Collector) handles
unstructured, ambiguous inputs and converts them to structured world state. This is
where Claude earns its place in the fast path.
**Rationale:** The original architecture treated Calendar and Beads as the only data
sources — both structured, both well-defined APIs. Real life generates commitments
through email prose ("can you review this?"), conversation ("I need to handle the Q3
review"), and calendar changes. Treating these as out-of-scope means the system
systematically misses a large fraction of actual obligations. The Intake Layer is what
makes Life Organizer an *organizer* rather than a task list with a calendar widget.
**Note:** Email Intake requires Gmail MCP or Google API access. Corporate email intake
requires user-configured forwarding rules (see Decision 12). Conversation Intake is
the highest-value/lowest-cost intake because Claude is already present.
**Status:** Approved 2026-05-17.

---

### Decision 12: Corporate Integration Has a Pragmatic Ceiling

**Date:** 2026-05-17
**Decision:** Full Exchange/Outlook integration (Microsoft Graph API, corporate OAuth)
is out of scope. The ceiling is: iCal URL subscription (read-only calendar, no IT
required) and user-configured email forwarding rules.
**Rationale:** Full corporate integration requires IT approval, a registered OAuth
application in the corporate Azure tenant, and ongoing security review. This is a
permission problem, not an architecture problem — and it's unlikely to be resolved for
a personal productivity tool. The pragmatic inroads (iCal URL + forwarding rules) provide
~70% of the scheduling value (free/busy, meeting titles, key email subjects) at zero IT
involvement. Design for this ceiling rather than blocking the system on an unlikely
approval path.
**Alternatives rejected:**
- AppleScript automation of Outlook (brittle, macOS-only, breaks on updates)
- Database-level Outlook access (fragile, possibly a terms-of-service violation)
- Waiting for official Microsoft MCP server (unknown timeline)
**Status:** Approved 2026-05-17.

---

## Open Questions

### Active (must resolve during Phase 1–2)

1. **Dolt remote hosting:** DoltHub (managed, free tier) vs. self-hosted Dolt server
   (more control, more ops). DoltHub is the default recommendation unless there are
   privacy concerns about issue content.

2. **Beads Service hosting:** Railway, Render, or Fly.io. All support Node.js, all
   have free/low-cost tiers. Railway has the simplest deploy story for a Node app.
   Decision needed before Phase 1b.

3. **World State schema ownership:** Supabase is the plan, but the exact schema needs
   design before any agent can write to it. This is a blocking dependency for
   Phase 1c and everything downstream. Priority: design this early.

4. **Rules Engine location:** Client-side (runs in PWA, offline-capable) vs.
   server-side Netlify function (authoritative, can trigger push). Recommendation:
   server-side for authoritative notifications, client-side mirror for offline/instant
   feedback. Resolve in Phase 2a.

### Important (resolve during Phase 3–4)

5. **Gmail OAuth for Email Intake:** Personal Gmail works via Google OAuth (same
   flow as Calendar). Scope needed: `gmail.readonly`. Does user want automatic intake
   (poll on schedule) or explicit intake (user-triggered "check email for tasks")?

6. **Conversation Intake trigger:** When does it run? Options: (a) user explicitly
   invokes "extract tasks from this conversation", (b) automatic at session end,
   (c) always-on with confidence gating. Option (a) is safest and most controllable
   to start.

7. **Pattern Analyzer auto-apply threshold:** How confident does the Analyzer need to
   be before auto-applying a rule change vs. surfacing it for human review? Start
   conservative (human review always), loosen as trust builds.

### Deferred (Phase 5+)

8. **Multi-user support:** Current design is single-user (Mo). If this becomes a
   product, the auth model, RLS policies, and Beads Service architecture all change
   significantly. Do not design for multi-user until there's demand.

9. **Apple Calendar integration:** iCal URL works for read-only corporate calendar.
   For personal Apple Calendar, same mechanism applies. AppleScript automation is
   possible but brittle. Wait for an official Apple Calendar MCP or CalDAV client.

10. **Voice capture → Conversation Intake:** Voice transcription (Whisper or similar)
    feeding directly into Conversation Intake Agent is an appealing extension but
    adds infrastructure (transcription service or local Whisper). Defer until Conversation
    Intake is stable in text form.

---

## Appendix: Verbatim Design Session Excerpts

The following characterisations emerged from the architectural design session and are
preserved verbatim as they capture the reasoning more directly than a cleaned-up summary.

---

**On what kind of system this is:**

> "Not a classic ReAct loop. Not quite a graph. The closest characterisation is a
> reactive multi-agent system with a shared world state, triggered by event beacons."

> "The key insight: intelligence happens at collection points, not continuously. The
> event beacons are what makes it feel autonomous. Between beacons, the system is at rest."

---

**On the Rules Engine:**

> "The rules are the executable memory of learned behaviour. The slow loop is what makes
> them improve over time without continuous AI expense. Claude's job isn't to run the
> system — it's to improve the rules that run the system."

> "So much of this is simply marking changes to state, noting changes to calendar(s),
> and waiting. Rules around 'this would be a good time' could be set initially, monitored
> periodically for habits and changes, and when noted and appropriate, revised. Running a
> suggestion needs to be a 'hey, this pattern matches the current world state' — New open
> block of time MATCHES a priority item that would benefit from/be completable within
> that block, and sufficient PRIORITY to make it worth a notification. All the heavy
> thinking happens periodically on whatever the current state and past observations
> show."

---

**On Conversation as Work Stream:**

> "What about the opportunity for CONVERSATIONS that lead to work streams. By this I guess
> I'm allowing for brainstorming, either independently or with Claude?"

> "This is actually the most architecturally interesting of the three — and the least
> exotic. It's already happening. The ARD was generated from a Claude conversation.
> The Beads issues were created from a Claude conversation. `bd remember` is a primitive
> version of this."

---

**On Corporate Integration:**

> "What about work items, where work is actually a corporate walled-garden of email,
> and calendars that can't be consumed directly?"

> "This is a permission problem, not an architecture problem. Full Exchange/Outlook
> integration requires IT + corporate OAuth. Not worth pursuing. The pragmatic inroads:
> iCal URL subscription + email forwarding rules. These provide ~70% of the scheduling
> value at zero IT involvement."

---

**On the Beads-as-a-Service Resolution:**

> "Is [Beads irreducibly local] true? Would a Beads database on something like Netlify
> be one way to approach the local/online disparity?"

> "Beads is NOT irreducibly local. Dolt's native remote sync means `server/index.js`
> (already built) can be deployed. Local `bd` work syncs via `bd dolt push`. Cloud
> functions read from the deployed service. No separate datastore or Beads adapter needed.
> The division point is the Dolt remote, not the local machine."

---

*End of ARD v2*

**Revision History**

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 2026-05-16 | Mo + Claude | Initial ARD — origin discussion, requirements, decisions 1–8 |
| 2.0 | 2026-05-17 | Mo + Claude | Full architectural redesign — event-driven intelligence, Intake Layer, Rules Engine, Beads-as-a-Service, Decisions 9–12 |
