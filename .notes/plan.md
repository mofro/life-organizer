# Implementation Plan - Life Organizer
# Task-Driven Development with Beads CLI

**Project:** Intelligent Life Organizer  
**Timeline:** 4-6 weeks to production MVP  
**Last Updated:** 2026-05-16

---

## Quick Start

This project uses `bd` (Beads) for task tracking. To get started:

```bash
# View ready tasks (no blockers)
bd ready

# Show task details
bd show bd-XXXX

# Claim a task to work on
bd update bd-XXXX --claim

# Close when complete
bd close bd-XXXX "Completed [what you did]"

# Remember insights for future context
bd remember "Important project insight here"

# Get workflow guidance
bd prime
```

**Never create markdown TODO lists - use Beads for all task tracking.**

---

## Project Structure

```
life-organizer/
├── .beads/              # Beads database (Dolt SQL)
├── .notes/              # Documentation
│   ├── ARD-life-organizer.md    # Complete architecture doc
│   └── plan.md          # This file
├── src/                 # React source code (Phase 1+)
├── netlify/             # Netlify functions (Phase 3+)
│   └── functions/
├── public/              # Static assets
├── netlify.toml         # Netlify configuration
├── package.json
├── .gitignore
└── README.md
```

---

## Phase 0: Foundation ✅ COMPLETE

**Duration:** Days 1-2  
**Status:** ✅ Complete

**Completed Tasks:**
- [x] Repository created at `/Users/mo/Code/life-organizer`
- [x] Beads initialized (`bd init`)
- [x] Documentation structure created
- [x] ARD written (complete discussion transcript)
- [x] Implementation plan created (this file)
- [x] .gitignore configured
- [x] README.md written

**Initial Beads Tasks Created:**
```bash
# Epic: Life Organizer MVP
bd create "Phase 1: Working MVP Artifact" -t epic -p 0

# Sub-tasks will be created as we begin implementation
```

---

## Phase 1: Working MVP Artifact

**Duration:** Week 1 (5-7 days)  
**Goal:** Functional Life Organizer running in Claude.ai as artifact

### Tasks

```bash
# Create task structure
bd create "Fix form input focus issues" -t task -p 1 --design "Use FormData API, uncontrolled inputs, no object spread in onChange"

bd create "Build task dashboard UI" -t task -p 1 --design "Dashboard, TaskList, QuickStats components. Tailwind styling."

bd create "Implement basic recommendation engine" -t task -p 2 --design "Simple algorithm: urgent tasks (deadline < 3 days), quick wins (< 1h), big blocks (3+ hours)"

bd create "Add calendar event display (mock)" -t task -p 2 --design "Static calendar events for testing, styled event cards"

bd create "Implement window.storage persistence" -t task -p 1 --design "Save/load tasks, preferences from window.storage API"

bd create "Test artifact in Claude.ai" -t task -p 1 --design "Deploy artifact, verify forms work, persistence works, no crashes"
```

### Dependencies
```bash
# Form fixes must come first
bd dep add [task-dashboard] [form-fixes]
bd dep add [recommendations] [task-dashboard]
bd dep add [storage] [task-dashboard]
```

### Success Criteria
- [ ] Can add tasks without form losing focus
- [ ] Recommendations appear based on mock data
- [ ] Tasks persist across browser refreshes
- [ ] No console errors in Claude.ai artifact environment

### Code Structure (Phase 1)

```javascript
// artifact-life-organizer.jsx
import React, { useState, useRef } from 'react';

const LifeOrganizer = () => {
  const [tasks, setTasks] = useState([]);
  const [calendarEvents] = useState([/* mock data */]);
  const formRef = useRef(null);

  // IMPORTANT: Use FormData, not controlled inputs!
  const addTask = () => {
    const formData = new FormData(formRef.current);
    const task = {
      id: Date.now(),
      title: formData.get('title'),
      category: formData.get('category'),
      priority: formData.get('priority'),
      timeRequired: parseInt(formData.get('timeRequired')),
      deadline: formData.get('deadline'),
      status: 'pending'
    };
    
    setTasks(prev => [...prev, task]);
    formRef.current.reset();
    
    // Persist to window.storage
    window.storage.set('tasks', JSON.stringify([...tasks, task]));
  };

  // Load from storage on mount
  useEffect(() => {
    window.storage.get('tasks').then(result => {
      if (result?.value) {
        setTasks(JSON.parse(result.value));
      }
    });
  }, []);

  // Calculate recommendations
  const recommendations = calculateRecommendations(tasks, calendarEvents);

  return (
    <div>
      <Dashboard recommendations={recommendations} />
      <TaskForm formRef={formRef} onSubmit={addTask} />
      <TaskList tasks={tasks} />
    </div>
  );
};
```

---

## Phase 2: MCP Integration

**Duration:** Week 2 (5-7 days)  
**Goal:** Real calendar data via MCP, Beads task display

### Tasks

```bash
bd create "Search for existing Beads MCP server" -t task -p 0 --design "Check npm, GitHub, tool_search. Document findings."

bd create "Build Beads MCP server (if needed)" -t task -p 0 --design "TypeScript, expose bd ready/list/show/claim/close. Test with Claude Desktop."

bd create "Integrate Google Calendar MCP" -t task -p 1 --design "Replace mock events with real Calendar MCP calls. Handle auth."

bd create "Display Beads tasks in dashboard" -t task -p 1 --design "New BeadsTasksSection component. Show task.id, title, priority, blocked_by"

bd create "AI time estimation for Beads tasks" -t task -p 2 --design "Call Anthropic API with task.title + design_doc, get hour estimate"

bd create "Update recommendations with real data" -t task -p 1 --design "Include Beads tasks + real calendar in recommendation logic"
```

### Dependencies
```bash
# Beads MCP must exist before integration
bd dep add [integrate-calendar] [search-beads-mcp]
bd dep add [display-beads] [search-beads-mcp]
bd dep add [ai-estimation] [display-beads]
```

### Success Criteria
- [ ] Shows real Google Calendar events
- [ ] Displays Beads tasks from local project(s)
- [ ] AI estimates time for Beads tasks
- [ ] Recommendations include both calendar and Beads data
- [ ] Can identify urgent Beads tasks (no deadline but high priority)

### Beads MCP Server Spec

If building from scratch:

```typescript
// beads-mcp-server/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = new Server({
  name: 'beads-mcp',
  version: '1.0.0'
});

// Tools to implement:
// - bd_ready: Get unblocked tasks
// - bd_list: List tasks (optional filter by status)
// - bd_show: Get task details
// - bd_claim: Claim task atomically
// - bd_close: Close task with reason

// See ARD Section "Technical Architecture" for full implementation
```

**Publish to npm:** `@life-organizer/beads-mcp`

### MCP Client Code

```javascript
// In Life Organizer artifact
async function getBeadsTasks(projectPath) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'user',
        content: `Get ready Beads tasks from ${projectPath}`
      }],
      mcp_servers: [{
        type: 'command',
        command: 'beads-mcp',
        args: ['--project', projectPath],
        name: 'beads'
      }]
    })
  });
  
  const data = await response.json();
  return parseBeadsTasks(data);
}
```

---

## Phase 3: PWA Deployment

**Duration:** Week 3 (5-7 days)  
**Goal:** Deployed to Netlify as installable PWA

### Tasks

```bash
bd create "Set up Netlify project" -t task -p 1 --design "Create Netlify account (or use existing), link GitHub repo, configure build"

bd create "Configure Supabase database" -t task -p 1 --design "Create Supabase project, run schema SQL, set up Row Level Security policies"

bd create "Create Netlify Functions for backend" -t task -p 2 --design "get-recommendations.js, sync-calendar.js functions. Handle Anthropic API calls."

bd create "Migrate window.storage to Supabase" -t task -p 2 --design "Replace window.storage calls with Supabase client. Handle auth."

bd create "Add PWA manifest and service worker" -t task -p 2 --design "manifest.json, service-worker.js for offline caching"

bd create "Configure environment variables" -t task -p 1 --design "Set SUPABASE_URL, ANTHROPIC_API_KEY in Netlify dashboard"

bd create "Deploy to production" -t task -p 0 --design "Push to main, verify Netlify build, test at life-organizer.netlify.app"

bd create "Test cross-device sync" -t task -p 1 --design "Create task on desktop, verify appears on mobile. Test offline mode."
```

### Dependencies
```bash
bd dep add [netlify-functions] [netlify-setup]
bd dep add [supabase-migration] [supabase-setup]
bd dep add [pwa-manifest] [supabase-migration]
bd dep add [deploy] [pwa-manifest]
bd dep add [deploy] [env-vars]
```

### Success Criteria
- [ ] Deployed to https://life-organizer.netlify.app
- [ ] Installable as PWA on desktop and mobile
- [ ] Tasks sync across devices
- [ ] Works offline with cached data
- [ ] Netlify Functions handle backend logic
- [ ] Supabase authentication works

### Netlify Configuration

**netlify.toml:**
```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

[[headers]]
  for = "/service-worker.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
```

### Supabase Schema

```sql
-- Run in Supabase SQL Editor

CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  priority TEXT CHECK (priority IN ('high', 'medium', 'low')),
  time_required INTEGER,
  deadline TIMESTAMP,
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed')),
  source TEXT DEFAULT 'manual',
  external_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own tasks"
  ON tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tasks"
  ON tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks"
  ON tasks FOR UPDATE
  USING (auth.uid() = user_id);
```

---

## Phase 4: Enhanced Features

**Duration:** Week 4-5 (7-10 days)  
**Goal:** Notifications and Beads quick actions

### Tasks

```bash
bd create "Implement email notifications via Gmail MCP" -t task -p 1 --design "Send email for urgent tasks (deadline < 24h). Use Gmail MCP send_message."

bd create "Add SMS notifications via Zapier MCP" -t task -p 3 --design "Optional SMS for critical deadlines. Zapier → Twilio integration."

bd create "Beads Claim button functionality" -t task -p 1 --design "Button calls bd_claim via MCP. Updates UI immediately."

bd create "Beads Close button with reason prompt" -t task -p 1 --design "Modal prompt for close reason. Calls bd_close via MCP."

bd create "Set up Netlify scheduled function" -t task -p 2 --design "Cron job: check urgent tasks hourly, send notifications"

bd create "Add notification preferences UI" -t task -p 2 --design "User settings: email/SMS toggle, quiet hours, notification threshold"

bd create "Test notification delivery" -t task -p 1 --design "Create test tasks with near deadlines, verify emails/SMS arrive"
```

### Dependencies
```bash
bd dep add [sms-notifications] [email-notifications]
bd dep add [beads-close] [beads-claim]
bd dep add [scheduled-function] [email-notifications]
bd dep add [test-notifications] [scheduled-function]
```

### Success Criteria
- [ ] Email sent when task deadline within 24 hours
- [ ] Can claim Beads task from Life Organizer UI
- [ ] Can close Beads task with reason from UI
- [ ] Background job runs hourly checking for urgent items
- [ ] User can configure notification preferences
- [ ] SMS notifications work (if implemented)

### Email Notification Function

```javascript
// netlify/functions/send-notifications.js
import { createClient } from '@supabase/supabase-js';

export async function handler(event, context) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  
  // Find urgent tasks
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const { data: urgentTasks } = await supabase
    .from('tasks')
    .select('*, users(email, name)')
    .lte('deadline', tomorrow.toISOString())
    .eq('status', 'pending');
  
  // Send emails via Gmail MCP
  for (const task of urgentTasks) {
    await sendGmailNotification(task);
  }
  
  return {
    statusCode: 200,
    body: JSON.stringify({ sent: urgentTasks.length })
  };
}

async function sendGmailNotification(task) {
  // Call Anthropic API with Gmail MCP
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'user',
        content: `Send email to ${task.users.email}:
Subject: 🚨 Task Due Tomorrow: ${task.title}
Body: Your task "${task.title}" is due tomorrow. Priority: ${task.priority}`
      }],
      mcp_servers: [{
        type: 'url',
        url: 'https://gmailmcp.googleapis.com/mcp/v1',
        name: 'gmail'
      }]
    })
  });
}
```

---

## Phase 5: Polish & Future Features

**Duration:** Week 6+ (ongoing)  
**Goal:** User experience improvements, optional features

### Potential Tasks

```bash
# These will be created ONLY if needed based on user feedback

bd create "Dependency graph visualization for Beads" -t feature -p 3 --design "Mermaid diagram showing blocked_by/blocks relationships"

bd create "Team coordination features" -t epic -p 4 --design "Multi-user backend, shared task pools, team calendar aggregation"

bd create "Apple Calendar integration via AppleScript" -t feature -p 3 --design "Use Control your Mac MCP to run AppleScript for Calendar.app"

bd create "Native mobile app (Electron/Tauri)" -t epic -p 4 --design "Only if PWA limitations become blockers"

bd create "Advanced AI pattern learning" -t feature -p 3 --design "Track when user is most productive, adjust recommendations"
```

### Evaluation Criteria

Before creating these tasks, answer:
1. Has a user explicitly requested this?
2. Is the current solution insufficient?
3. Will this add significant value vs complexity?
4. Is there budget/time for this?

**Default answer: NO - defer until proven necessary.**

---

## Beads Workflow for This Project

### Daily Workflow

```bash
# Morning: Start work session
bd ready                    # See what's ready to work on
bd show bd-XXXX             # Review task details
bd update bd-XXXX --claim   # Claim the task

# During work: Track progress
bd remember "Learned that FormData is better than controlled inputs for forms"
bd remember "Supabase RLS policies must be set up before deployment"

# End of day: Close completed work
bd close bd-XXXX "Implemented task dashboard with Tailwind. All tests passing."

# File remaining work for tomorrow
bd create "Fix mobile responsive layout" -t task -p 2
```

### Sprint Planning

```bash
# Start of week: Review priorities
bd list --status=open --json | jq '.[] | select(.priority <= 1)'

# Check dependencies
bd list --json | jq '.[] | select(.blocked_by | length > 0)'

# See progress
bd list --status=closed --json | jq 'length'  # Count completed
```

### Integration with AI Assistants

```bash
# Get context for Claude
bd prime

# This outputs:
# - Current ready tasks
# - Recent memories (bd remember)
# - Blocked tasks and why
# - Overall project status
```

**Always run `bd prime` at the start of each Claude session to give full context.**

---

## Testing Strategy

### Phase 1 Testing (Artifact)

```bash
bd create "Test form submissions (50+ rapid entries)" -t test -p 1
bd create "Test window.storage persistence (clear browser, reload)" -t test -p 1
bd create "Test recommendation accuracy (mock data)" -t test -p 2
```

**Manual Testing Checklist:**
- [ ] Can type in all form fields without losing focus
- [ ] Can add 10+ tasks rapidly
- [ ] Tasks persist after browser refresh
- [ ] Recommendations update when tasks added
- [ ] No console errors
- [ ] Works in Claude.ai artifact environment

### Phase 2 Testing (MCP)

```bash
bd create "Test Google Calendar MCP connection" -t test -p 0
bd create "Test Beads MCP with multiple projects" -t test -p 1
bd create "Test AI time estimation accuracy" -t test -p 2
```

**Manual Testing Checklist:**
- [ ] Real calendar events display correctly
- [ ] Beads tasks load from local projects
- [ ] AI time estimates are reasonable (validate with Mo)
- [ ] Can switch between multiple Beads projects
- [ ] MCP errors handled gracefully

### Phase 3 Testing (PWA)

```bash
bd create "Test Netlify deployment pipeline" -t test -p 1
bd create "Test Supabase auth and RLS" -t test -p 0
bd create "Test cross-device sync" -t test -p 1
bd create "Test offline mode" -t test -p 1
bd create "Test PWA installation (desktop + mobile)" -t test -p 1
```

**Manual Testing Checklist:**
- [ ] Deploy succeeds on push to main
- [ ] Auth works (sign up, sign in, sign out)
- [ ] Task created on desktop appears on mobile
- [ ] Works offline with cached data
- [ ] Installs as PWA on macOS
- [ ] Installs as PWA on iOS (if applicable)

### Phase 4 Testing (Notifications)

```bash
bd create "Test email delivery reliability" -t test -p 1
bd create "Test SMS delivery (if implemented)" -t test -p 2
bd create "Test scheduled function execution" -t test -p 1
bd create "Test Beads MCP write operations" -t test -p 0
```

**Manual Testing Checklist:**
- [ ] Email arrives for urgent task
- [ ] Email content is correct
- [ ] SMS arrives (if implemented)
- [ ] Scheduled function runs on time
- [ ] Claiming Beads task works from UI
- [ ] Closing Beads task updates Beads database

---

## Risk Mitigation

### Critical Risks

**Risk 1: Form Focus Issues Resurface**
```bash
bd create "SPIKE: Research React form patterns" -t spike -p 0 --design "If forms break again, investigate Formik, React Hook Form, or pure HTML forms"
```

**Risk 2: MCP Server Unavailable**
```bash
bd create "Implement MCP fallback graceful degradation" -t task -p 2 --design "Show cached data if MCP call fails. Display warning to user."
```

**Risk 3: Anthropic API Costs Exceed Budget**
```bash
bd create "Add usage tracking and limits" -t task -p 2 --design "Track API calls per user, warn at 80% of budget, hard limit at 100%"
```

**Risk 4: Beads Schema Changes Break Integration**
```bash
bd create "Add Beads version checking" -t task -p 2 --design "Check bd --version, warn if incompatible, show upgrade instructions"
```

### Monitoring Plan

```bash
# Create monitoring tasks AFTER Phase 3 deployment
bd create "Set up error tracking (Sentry)" -t task -p 2
bd create "Set up analytics (Plausible)" -t task -p 3
bd create "Create uptime monitoring" -t task -p 2
bd create "Set up cost alerts (Anthropic API)" -t task -p 1
```

---

## Definition of Done

### For Each Task:
- [ ] Code written and tested
- [ ] No console errors
- [ ] Works in target environment (artifact/PWA)
- [ ] Documented (if non-obvious)
- [ ] Reviewed (self-review or pair)
- [ ] Committed with clear message
- [ ] Beads task closed with summary

### For Each Phase:
- [ ] All phase tasks closed
- [ ] Success criteria met
- [ ] Demo-able to end user (Mo)
- [ ] No critical bugs
- [ ] Memory captured (`bd remember` used)
- [ ] Phase retrospective completed

### For MVP Release:
- [ ] All Phase 1-4 tasks complete
- [ ] Deployed to production URL
- [ ] End-to-end testing passed
- [ ] User documentation written
- [ ] Known issues documented
- [ ] Future roadmap defined

---

## Quick Reference Commands

```bash
# Daily commands
bd ready                                 # What can I work on?
bd show bd-XXXX                          # Task details
bd update bd-XXXX --claim                # Claim task
bd close bd-XXXX "Done"                  # Close task
bd prime                                 # Get context for Claude

# Planning commands
bd create "Task" -t task -p 1            # Create task
bd dep add bd-CHILD bd-PARENT            # Add dependency
bd list --status=open --json             # See all open

# Memory commands
bd remember "Key insight"                # Store insight
bd prime                                 # View memories + context

# Project commands
bd list --json | jq '.[] | select(.status == "in_progress")'  # Active tasks
bd list --json | jq '.[] | select(.priority <= 1)'            # High priority
```

---

## Next Steps

**Immediate actions (today):**
1. ✅ Complete Phase 0 (foundation)
2. ✅ Push to GitHub
3. Create initial Phase 1 tasks in Beads:
   ```bash
   bd create "Fix form input focus issues" -t task -p 1
   bd create "Build task dashboard UI" -t task -p 1
   bd create "Implement basic recommendation engine" -t task -p 2
   ```
4. Run `bd ready` to see first task to tackle
5. Begin Phase 1 implementation

**This week:**
- Complete Phase 1 (Working MVP Artifact)
- Test thoroughly in Claude.ai
- Gather feedback from Mo
- Adjust priorities based on what works/doesn't

**Next week:**
- Begin Phase 2 (MCP Integration)
- Search for Beads MCP server
- Integrate Google Calendar

---

**Remember:** This is a living document. Update as priorities shift, risks materialize, or new insights emerge. Use `bd remember` to capture key learnings!
