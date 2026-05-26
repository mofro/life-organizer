# Life Organizer

An event-driven intelligence system that collects world state (calendar, tasks, Beads issues), runs a rules engine over it, and surfaces AI-powered recommendations through a React PWA.

**Live:** https://life-organizer-mo.netlify.app

---

## Architecture

```
React PWA (Vite)
      ↓
Netlify Functions (serverless)
      ↓                    ↓
Supabase (world state)   Railway (Beads Service)
      ↓                    ↓
  open_tasks           beads-global (Dolt)
  calendar_snapshot    ←── bd repo sync ──← project repos
  recommendation_history
  user_preferences
```

Full design: [`.notes/ARD-v2-system-architecture.md`](.notes/ARD-v2-system-architecture.md)

### Netlify Functions

| Function | Purpose |
|---|---|
| `collect-world-state` | Aggregates tasks, Beads issues, calendar, and Gmail into Supabase |
| `recommend` | Claude-powered focus/queue/overdue portfolio (GET restores, POST refreshes) |
| `recommendations` | PATCH endpoint for thumbs feedback write-back |
| `evaluate-rules` | Runs the rules engine over world state, returns fired alerts |
| `intake` | Conversation intake agent — Claude extracts tasks from pasted text |
| `beads-show` | Proxy: GET /api/beads/show/:id on Railway |
| `beads-create` | Proxy: POST /api/beads/create on Railway |
| `tasks` | CRUD for open_tasks (GET/POST/PATCH/DELETE) |
| `schedule-task` | Creates a Google Calendar event for a task |
| `calendar-sync` | On-demand Google Calendar sync |
| `calendar-sync-scheduled` | Nightly (06:00 UTC) Google + iCal sync |
| `ical-sync` | On-demand iCal feed sync |
| `ical-feeds` | Manage iCal feed URLs (GET/POST/DELETE) |
| `ical-save-url` | Legacy single-URL save (superseded by ical-feeds) |
| `notifications` | Reads fired notifications from Supabase |
| `auth-google-callback` | Google OAuth callback |
| `auth-google-refresh` | Google token refresh |
| `auth-google-status` | Google connection status check |

---

## Features

- **Task management** — manual tasks in Supabase `open_tasks`, with deadlines, priorities, time estimates
- **Beads integration** — ready issues pulled from Railway-hosted Beads service; create issues from intake agent
- **Google Calendar** — OAuth-connected, synced to 14-day snapshot, used for free-block calculation
- **Multi-feed iCal** — add any number of iCloud, Outlook, or CalDAV feeds; labelled by domain
- **Claude recommendations** — Focus Now + Up Next queue with thumbs feedback; 30-min server cache
- **Rules Engine** — alert notifications triggered by world state patterns
- **Conversation Intake Agent** — paste a Claude session or note; Claude extracts tasks/commitments with confidence routing (auto-create ≥0.80, review 0.50–0.79, questions panel, low-confidence collapsed)

---

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, PWA (Workbox)
- **Backend:** Netlify Functions (ESM)
- **Database:** Supabase (PostgreSQL) — world state, tasks, calendar snapshot, preferences
- **Beads Service:** Railway — hosts `bd` CLI + beads-global Dolt database
- **AI:** Anthropic Claude (claude-sonnet-4-6 for recommendations, claude-haiku-4-5-20251001 for intake)
- **Email:** Resend — transactional email for auth (magic link) and rules engine alerts
- **CDN dependency:** `@supabase/supabase-js@2` loaded at runtime from `https://esm.sh` in the `/dashboard` SPA. Not bundled — loaded from CDN so the dashboard function (which serves plain HTML) can use the SDK without a build step. `script-src` CSP includes `https://esm.sh`.

---

## Environment Variables

### Netlify (server-side functions)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API access |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (full DB access) |
| `SUPABASE_USER_ID` | Single-user UUID (owner of all rows) |
| `BEADS_SERVICE_URL` | Railway Beads Service base URL |
| `BEADS_API_KEY` | Railway auth bearer token |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `RESEND_API_KEY` | Resend API key — used for rules engine alert emails (life-xnb). Also configured in Supabase SMTP settings to route auth emails through Resend (bypasses Supabase's 3 emails/hour free-tier cap). |

### Vite (client-side, prefix `VITE_`)

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase URL (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID (for Connect button) |

---

## Local Development

```bash
npm install
netlify dev        # Runs Vite + Netlify Functions together on http://localhost:8888
```

`netlify dev` is required (not `npm run dev`) — the functions need the Netlify dev proxy to resolve env vars and routes.

### Prerequisites

- Node.js 18+
- Netlify CLI: `npm install -g netlify-cli`
- A `.env.local` file with the variables above (copy from Netlify dashboard)

---

## Deployment

```bash
netlify deploy --prod
```

Netlify CI/CD also deploys automatically on push to `main`.

---

## Database

Supabase project: `vmjcqxuxltzskuudfsri` (East US / North Virginia)

Migrations live in `supabase/migrations/`. Apply with:

```bash
supabase db push --workdir /path/to/life-organizer --yes
```

Requires a Supabase access token: `supabase login` (stores token at `~/.config/supabase/access-token`).

### Key tables

| Table | Purpose |
|---|---|
| `open_tasks` | Manual tasks with deadline, priority, time estimate |
| `calendar_snapshot` | 14-day rolling window of events from all calendar sources |
| `recommendation_history` | Claude recommendation responses + thumbs feedback |
| `user_preferences` | Google OAuth tokens, iCal feeds, schedule config |
| `world_state` | Latest snapshot from collect-world-state |
| `notification_log` | Rules engine fired alerts |

---

## Beads Service (Railway)

Hosts the `bd` CLI against a beads-global Dolt clone. Endpoints:

- `GET /api/health`
- `GET /api/beads/ready`
- `GET /api/beads/list`
- `GET /api/beads/show/:id`
- `POST /api/beads/create`
- `POST /api/beads/claim/:id`
- `POST /api/beads/close/:id`
- `GET /api/beads/stats`
- `POST /api/beads/sync`

Auth: `Authorization: Bearer $BEADS_API_KEY`

---

## Issue Tracking

This project uses [Beads](https://github.com/gastownhall/beads) (`bd` CLI):

```bash
bd ready              # Available work
bd show <id>          # Issue details
bd update <id> --claim
bd close <id> --reason "..."
```
