# Intelligent Life Organizer

An AI-powered productivity application that bridges calendar management and task prioritization, providing intelligent recommendations for optimal time utilization.

**Status:** 🏗️ In Development - Phase 0 Complete

---

## What It Does

Life Organizer acts as an intelligent orchestration layer that analyzes your:
- **Calendar** (Google Calendar, future: Apple Calendar)
- **Tasks** (self-managed + Beads CLI integration)
- **Current Context** (time of day, available time blocks, deadlines)

And provides **AI-powered recommendations** like:
- _"Your 3pm meeting was cancelled - perfect time for that 2-hour project you've been postponing"_
- _"🚨 Flight booking deadline tomorrow - you should handle this today"_
- _"You have three 30-minute gaps today - ideal for these quick wins..."_

---

## Key Features

### Current (Phase 0-1)
- ✅ Task management with time estimates and deadlines
- ✅ Basic AI recommendation engine
- ✅ Clean form inputs (no focus loss issues)
- ✅ Browser-based storage (window.storage)

### Coming Soon (Phase 2-4)
- 🔄 Google Calendar integration via MCP
- 🔄 Beads CLI task integration (read-only + quick actions)
- 🔄 Email notifications for urgent tasks
- 🔄 PWA deployment (installable, works offline)
- 🔄 Cross-device sync via Supabase

### Future (Phase 5+)
- ⏳ SMS notifications
- ⏳ Apple Calendar integration
- ⏳ Team coordination features
- ⏳ Native mobile app (if PWA insufficient)

---

## Architecture

### Modern MCP-First Design

Instead of building custom integrations, Life Organizer leverages the **Model Context Protocol (MCP)** to connect with external services:

```
Life Organizer (React + Claude)
        ↓
   MCP Protocol
        ↓
┌────────────────────────────────┐
│  Calendar MCP  │  Gmail MCP    │
│  Beads MCP     │  Drive MCP    │
│  Zapier MCP    │  (extensible) │
└────────────────────────────────┘
```

**Benefits:**
- 70-80% less integration code
- Future-proof (new services = new MCP, not new code)
- Leverages existing MCP servers (Calendar, Gmail, Drive already exist)

### Tech Stack

**Frontend:**
- React 18
- Tailwind CSS
- Lucide React (icons)

**Backend:**
- Netlify Functions (serverless)
- Supabase (PostgreSQL + Auth)
- Anthropic Claude API (AI recommendations)

**Integrations:**
- Google Calendar MCP
- Gmail MCP
- Beads MCP (to be built)
- Google Drive MCP (optional)

---

## Project Structure

```
life-organizer/
├── .beads/                  # Beads task database (Dolt SQL)
├── .notes/                  # Documentation
│   ├── ARD-life-organizer.md   # Complete architecture doc
│   └── plan.md              # Implementation plan with Beads tasks
├── src/                     # React source (Phase 1+)
├── netlify/                 # Serverless functions (Phase 3+)
├── public/                  # Static assets
├── package.json
├── netlify.toml             # Deployment config
└── README.md                # This file
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Git
- **Beads CLI** (`bd`) - [Install Guide](https://github.com/gastownhall/beads)

### Installation

```bash
# Clone repository
git clone https://github.com/YOUR-USERNAME/life-organizer.git
cd life-organizer

# Install dependencies
npm install

# Validate prerequisites
npm run check

# Start dev server (Vite + local API server)
npm start
```

> **Note:** Use `npm start` — not `npm run dev` (frontend only) and not `npm start dev` (invalid).

### Troubleshooting

**Beads section shows "server offline"**

The local API server failed to start. Check the terminal output for `[server]` lines.

Common causes:

| Symptom | Fix |
|---|---|
| `bd not found in PATH` | Ensure Beads is installed and `/bin/zsh` can find it: `which bd` in a zsh terminal |
| `beads-global not found` | `mkdir ~/beads-global && cd ~/beads-global && bd init` |
| Port 3001 in use | `lsof -ti:3001 \| xargs kill` then restart |
| Dependencies missing | `npm install` |

Run `npm run check` to diagnose all prerequisites at once.

**Verify the API server is running:**

```bash
curl http://localhost:3001/api/health
# Expected: {"ok":true,"bdPath":"...","bdVersion":"...","bdgDir":"..."}
```

### Beads is already initialized - view tasks

```bash
bd ready
```

### Development Workflow

This project uses **Beads** for task management. Standard workflow:

```bash
# See what's ready to work on
bd ready

# View task details
bd show bd-XXXX

# Claim a task
bd update bd-XXXX --claim

# Work on the task...

# Close when complete
bd close bd-XXXX "Completed [description]"

# Remember key insights for future context
bd remember "FormData works better than controlled inputs for this use case"

# Get full project context (for Claude sessions)
bd prime
```

**Never create markdown TODO lists - all tasks go in Beads.**

---

## Documentation

### For Developers

- **[Architecture Requirements Document (ARD)](.notes/ARD-life-organizer.md)** - Complete discussion transcript, architecture decisions, technical details
- **[Implementation Plan](.notes/plan.md)** - Phase-by-phase breakdown with Beads task structure

### For Users (Future)

- User Guide (coming after Phase 3 deployment)
- API Documentation (if applicable)
- Troubleshooting Guide

---

## Current Status

### Phase 0: Foundation ✅ COMPLETE
- [x] Repository created
- [x] Beads initialized
- [x] Documentation written (ARD + Implementation Plan)
- [x] .gitignore configured
- [x] README created (this file)

### Phase 1: Working MVP Artifact 🚧 IN PROGRESS
- [ ] Fix form input focus issues
- [ ] Build task dashboard UI
- [ ] Implement basic recommendation engine
- [ ] Add calendar event display (mock data)
- [ ] Implement window.storage persistence
- [ ] Test in Claude.ai artifact environment

See [Implementation Plan](.notes/plan.md) for full roadmap.

---

## Contributing

This is currently a personal project in active development. Once MVP is complete, contribution guidelines will be published.

**If you want to help:**
1. Check the [Implementation Plan](.notes/plan.md)
2. Look at `bd ready` output for available tasks
3. Open an issue to discuss before starting work

---

## Beads Integration

This project uses **Beads** for:
1. **Task Tracking** - All development tasks managed via `bd` CLI
2. **Feature Integration** - Beads tasks displayed in Life Organizer UI (Phase 2+)
3. **Project Memory** - `bd remember` captures key insights for future context

**Why Beads?**
- Git-based version control for tasks
- Dependency tracking (blocks/blocked_by)
- AI agent-optimized (JSON output, hash-based IDs)
- Multi-agent/multi-branch workflow support

Learn more: [Beads GitHub](https://github.com/gastownhall/beads)

---

## Deployment

### Current (Phase 0-1): Claude.ai Artifact
Runs in Claude.ai chat interface. No deployment needed.

### Future (Phase 3+): Netlify + Supabase
```bash
# Build
npm run build

# Deploy to Netlify
git push origin main  # Auto-deploys via Netlify CI/CD

# Production URL (after Phase 3)
https://life-organizer.netlify.app
```

---

## Architecture Decisions

### Why MCP-First?
**Question:** "Isn't this just reinventing AI Tools discovery and creating a really basic Agent?"

**Answer:** Yes! And that's the point. Instead of reinventing:
- Tool discovery → Use MCP protocol
- Tool calling → Use MCP clients
- Custom integrations → Use existing MCP servers

**Result:** 2-4 weeks to MVP instead of 6+ months

### Why Netlify + Supabase?
- User already has Netlify relationship
- Both have generous free tiers
- Best developer experience
- Can scale to production without rewrite

### Why Read-Only Beads Integration?
- Preserves existing Beads workflow
- Adds AI intelligence layer on top
- Low complexity, low risk
- Can upgrade to write operations later if needed

See [ARD Decision Log](.notes/ARD-life-organizer.md#decision-log) for complete list.

---

## FAQ

**Q: Why not just use Google Tasks/Apple Reminders?**  
A: Life Organizer adds AI-powered time-matching. It doesn't just list tasks - it tells you *when* to do them based on your calendar and context.

**Q: Does this require Claude Pro?**  
A: Phase 1 (artifact) works in free Claude.ai. Phase 3+ (PWA) uses Anthropic API (separate cost).

**Q: What's the Beads integration about?**  
A: Beads is a git-based task tracker used for *this project's development*. Life Organizer also integrates with Beads for users who use it. Optional feature.

**Q: Why MCP instead of direct API calls?**  
A: MCP provides standardized protocol for tool calling. One integration pattern works for all services. Future-proof and extensible.

**Q: When will this be production-ready?**  
A: Target: 4-6 weeks to functional MVP (Phase 1-4 complete). See [Implementation Plan](.notes/plan.md) for timeline.

---

## License

MIT (to be added after MVP complete)

---

## Contact

Mo - Engineer at Comcast, TTRPG enthusiast, AI productivity tool builder

Project Link: [https://github.com/YOUR-USERNAME/life-organizer](https://github.com/YOUR-USERNAME/life-organizer)

---

## Acknowledgments

- **Anthropic Claude** - AI architecture and development assistance
- **Beads CLI** - Task tracking infrastructure
- **MCP Protocol** - Modern integration standard
- **Netlify + Supabase** - Hosting and database infrastructure

---

**Start here:** Check the [Implementation Plan](.notes/plan.md) and run `bd ready` to see current tasks!
