# Architecture Requirements Document (ARD)
# Intelligent Life Organizer

**Document Version:** 1.0  
**Date:** May 16, 2026  
**Author:** Mo (with Claude Sonnet 4.5)  
**Status:** Draft - Pre-Implementation

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Project Vision](#project-vision)
3. [Complete Discussion Transcript](#complete-discussion-transcript)
4. [Technical Architecture](#technical-architecture)
5. [Integration Strategy](#integration-strategy)
6. [Deployment Model](#deployment-model)
7. [Implementation Phases](#implementation-phases)
8. [Risk Assessment](#risk-assessment)
9. [Decision Log](#decision-log)
10. [Open Questions](#open-questions)

---

## Executive Summary

The Intelligent Life Organizer is a productivity application that bridges calendar management and task prioritization, providing AI-powered recommendations for optimal time utilization. The application leverages modern MCP (Model Context Protocol) servers for integration with existing productivity tools, eliminating the need for custom backend infrastructure.

**Key Architectural Decisions:**
- **MCP-First Architecture:** Use Model Context Protocol for all external integrations
- **Deployment Model:** Start with Claude.ai artifact, migrate to Netlify PWA
- **Data Storage:** window.storage for MVP, Supabase PostgreSQL for production
- **Integration Approach:** Read-only integration with Beads CLI via MCP server

**Target Timeline:** 2-4 weeks to functional MVP

---

## Project Vision

An intelligent productivity tool that:
- Integrates with existing calendars (Google Calendar) to understand schedule
- Manages tasks with time estimates and deadlines
- Provides AI-powered recommendations ("Perfect time for 3-hour project")
- Integrates with Beads CLI for engineering task management
- Sends smart notifications via email/SMS
- Supports optional team coordination features

**Core Value Proposition:** Act as an intelligent orchestration layer that analyzes your calendar, tasks, and context to proactively suggest what to work on and when.

---

## Complete Discussion Transcript

### Initial Concept & Form Issues

**User Request:** "I need a tool that will help to organize my life events, and help me to prioritize when to spend time on continuing plans or tasks given my schedule!"

**Initial Implementation Challenges:**
- React form inputs losing focus after each keystroke
- Object spread operations creating new references on every onChange
- useEffect watchers causing unnecessary re-renders
- Over-engineered state management

**Root Cause Identified:**
```javascript
// WRONG - Creates new object on every keystroke
onChange={(e) => setNewTask({...newTask, title: e.target.value})}

// CORRECT - Uncontrolled form with FormData
<form ref={formRef}>
  <input name="title" />
</form>
```

**Key Learning:** Forms don't need to be "reactive" to every keystroke - capture data on submit using FormData API.

---

### Requirements Evolution & Modern Capabilities

**Initial Plan (2024-style):**
- Custom backend with OAuth flows
- Manual calendar API integration
- Custom notification infrastructure
- Email delivery service (SendGrid/Mailgun)
- Complex sync logic
- **Timeline:** 6+ months

**2026 Reality with MCP:**
- MCP servers handle OAuth and API integration
- Google Calendar MCP already exists
- Gmail MCP for notifications
- Minimal or no custom backend needed
- **Timeline:** 2-4 weeks

**Critical Realization:** "We're reinventing MCP server discovery and creating a basic agent architecture. Why not use MCP directly?"

---

### Feature Request Analysis

#### 1. Apple Ecosystem Connections

**Feasibility Options:**

**Option A: AppleScript Bridge (macOS only)** ⭐ RECOMMENDED FOR MVP
- Use existing "Control your Mac" MCP to run AppleScript
- Access Calendar.app and Mail.app natively
- **Timeline:** 1-2 weeks
- **Limitation:** macOS only, no iOS support

**Option B: CalDAV/IMAP Protocol Layer**
- Build CalDAV client for iCloud Calendar
- IMAP for iCloud Mail
- **Timeline:** 3-4 weeks
- **Complexity:** High - must handle iCloud's non-standard quirks

**Option C: Wait for Apple MCP Servers**
- Unknown timeline
- Cleanest integration when available

**Recommendation:** Start with Google Calendar (existing MCP), add Apple support via AppleScript if demand justifies effort.

---

#### 2. Beads CLI Integration

**What Beads Actually Is:**
- Dolt-based distributed task tracker (NOT file-based)
- Version-controlled SQL database in `.beads/embeddeddolt/`
- Optimized for AI agents with dependency graphs
- 23.5k GitHub stars, actively maintained
- Access via `bd` CLI with `--json` output

**Critical Data Gaps:**
- Beads tasks have NO time estimates
- Beads tasks have NO deadlines
- These are core to Life Organizer's value prop (matching tasks to free time blocks)

**Integration Options:**

**Option A: Read-Only CLI Integration** ⭐ RECOMMENDED
```javascript
// Pull Beads tasks
const tasks = execSync('bd ready --json');

// AI estimates time from title/design
const estimated = await claudeEstimateTime(task.title, task.design_doc);

// Include in recommendations
recommendations.push({
  message: `Perfect time for ${task.id} (estimated ${estimated}h)`
});
```

**Timeline:** 3-5 days  
**Value:** Beads tasks become visible to AI recommendations  
**Tradeoff:** Can't create/update Beads tasks from Life Organizer UI

**Option B: Bidirectional Sync**
- Full CRUD from Life Organizer
- Complex conflict resolution needed
- **Timeline:** 3-4 weeks
- **Recommendation:** ❌ Too complex for MVP

**Option C: Beads as External Display**
- Show Beads tasks in dashboard
- Click opens terminal
- **Timeline:** 2-3 days
- **Use case:** Casual Beads users

**Option D: Migration Path**
- One-time import, then deprecate Beads
- Loses git-based versioning and dependency graph
- **Recommendation:** ⚠️ Only if willing to abandon Beads workflow

**Schema Mapping Challenges:**

| Beads Field | Life Organizer | Mapping Strategy |
|-------------|----------------|------------------|
| `id` (bd-a1b2) | `id` (numeric) | Store as external_id |
| `type` (bug/task/epic) | `category` | Direct map |
| `blocked_by` / `blocks` | ❌ None | Visualize, don't store |
| ❌ No deadline | `deadline` | **AI estimate or user input** |
| ❌ No time estimate | `timeRequired` | **AI estimate from design_doc** |

**Beads Registration Pattern:**

*User suggested:* "What if Beads projects register themselves with Life Organizer?"

**Brilliant architectural insight** - eliminates deep filesystem search:

```json
// ~/.config/life-organizer/beads-projects.json
{
  "projects": [
    {
      "id": "tarim-shaiel-campaign",
      "path": "/Users/mo/projects/tarim-shaiel-campaign-frame",
      "nickname": "TTRPG Campaign",
      "registered_at": "2026-05-16T10:30:00Z"
    }
  ]
}
```

**Registration Flow:**
```bash
# After bd init
life-organizer register-beads --auto

# Or manually
life-organizer register-beads ~/path/to/project --nickname "Work AI Platform"
```

**Critical Realization:** "This is just MCP server discovery! We're reinventing AI tools discovery and creating a loose MCP-like service around bd."

**Correct Approach:** Build or use Beads MCP server instead of custom registry.

---

#### 3. Device Syncing

**Options:**

**Option A: Cloud Backend (OS Agnostic)** ⭐ RECOMMENDED
- Firebase/Supabase/PocketBase
- **Timeline:** 2-3 weeks
- **Cost:** $0-25/month

**Option B: iCloud (Apple Only)**
- CloudKit or iCloud Drive
- **Timeline:** 3-4 weeks
- **Limitation:** Apple ecosystem only

**Option C: Google Drive MCP (Creative!)**
- Store tasks as JSON in Google Drive
- Uses existing Drive MCP
- **Timeline:** 1-2 weeks
- **Tradeoff:** Not optimized for queries, but zero DB cost

**Option D: Hybrid Local-First**
- Local storage primary, optional cloud sync
- **Timeline:** 4-6 weeks
- **Complexity:** CRDTs or operational transform needed

**Recommendation:** Google Drive MCP for near-term (uses existing MCP), Supabase when user base justifies cost.

---

#### 4. Native OS Versions

**Options:**

**Option A: Electron** (macOS + Windows + Linux)
- Wrap React app in Electron
- **Timeline:** 2-3 weeks
- **Cons:** ~100MB app size

**Option B: Tauri** (Rust + Web)
- Smaller (~10MB), faster
- **Timeline:** 3-4 weeks
- **Cons:** Less mature ecosystem

**Option C: Native Swift** (macOS/iOS only)
- Best performance, App Store eligible
- **Timeline:** 8-12 weeks
- **Cons:** Separate codebase, 2x development effort

**Option D: PWA** ⭐ RECOMMENDED
- Enhance web app with PWA features
- **Timeline:** 1 week
- **Cons:** iOS limitations (no push notifications)

**Recommendation:** PWA first (1 week), then Electron if demand justifies (3 weeks).

---

#### 5. Airmail and/or Fantastical Integration

**Reality Check:**
- ❌ No Airmail API (it's a client, not a service)
- ❌ No Fantastical API publicly available
- ❌ No MCP servers for either

**Options:**

**Option A: AppleScript Automation** (macOS only)
- **Timeline:** 2-3 weeks per app
- **Risk:** HIGH - brittle, breaks with app updates

**Option B: Reverse Engineering (Database Access)**
- Read app databases directly
- **Risk:** EXTREME - fragile, possibly unethical/illegal

**Option D: Use Underlying Services** ⭐ RECOMMENDED
- Instead of Airmail → use IMAP/Mail.app
- Instead of Fantastical → use Calendar.app/CalDAV
- **Rationale:** Users can still use Airmail/Fantastical as their interface, but Life Organizer talks to the same iCloud account

**Recommendation:** Integrate with iCloud services, not the apps. Users' Fantastical/Airmail already see the same data.

---

### MCP Architecture Realization

**The Epiphany:**

*User:* "Isn't this just reinventing AI Tools discovery and creating a really basic Agent? This is wrapping a very loose MCP-like service around bd. Tell me why those conceptual frames are wrong."

**Answer:** They're NOT wrong - they're exactly right!

**What We Were Building:**
```javascript
// Custom registry
{
  "projects": [{"id": "tarim", "path": "/projects/tarim"}]
}

// Custom bd wrapper
function getBeadsTasks(project) {
  exec(`cd ${project.path} && bd ready --json`);
}
```

**What MCP Already Provides:**
```javascript
// MCP server configuration
{
  "mcpServers": {
    "beads-tarim": {
      "command": "bd",
      "args": ["--project", "/projects/tarim"]
    }
  }
}

// MCP client calls
await mcpClient.call('beads-tarim', 'bd_ready', {});
```

**Life Organizer IS an Agent:**
- **Perception:** Reads from MCP servers (Calendar, Beads, Email)
- **Reasoning:** Claude analyzes free time + task urgency
- **Action:** Updates tasks via MCP calls
- **Memory:** Stores preferences + patterns

**Modern Agent Architecture:**
```
Agent = LLM + MCP Tools + Persistent State
```

Life Organizer is a **specialized agent** for productivity/time management.

---

### Deployment & Infrastructure

**User Questions:**
1. Are Vercel and Netlify synonymous?
2. Are there other free edge-function servers and datastore vendors?

**Analysis:**

#### Vercel vs Netlify

| Feature | Vercel | Netlify |
|---------|--------|---------|
| Edge Functions | ✅ | ✅ |
| Free Tier | 100GB bandwidth | 100GB bandwidth, 125k calls |
| Forms | ❌ | ✅ Built-in |
| MCP Integration | ✅ Has MCP | ✅ Has MCP |

**Verdict:** Synonymous for our use case. **Use Netlify** since you already have a relationship.

#### Alternative Stacks (Free Tier)

**Option 1: Netlify + Supabase** ⭐ RECOMMENDED
```
Frontend: Netlify (125k function calls/month free)
Database: Supabase (500MB Postgres free)
Auth: Supabase Auth (free)
Real-time: Supabase Realtime (free)
```
- **Cost:** $0 at personal scale, $25/month if you grow
- **Why:** Best DX, you already use Netlify, can scale

**Option 2: Cloudflare Pages + D1** 💰 ULTRA-CHEAP
```
Frontend: Cloudflare Pages (unlimited requests)
Database: D1 (5GB SQLite free)
Workers: 100k requests/day free
```
- **Cost:** Probably $0 forever
- **Why:** Most generous free tier, fastest global performance
- **Tradeoff:** More complex than Netlify

**Option 3: Deno Deploy + Supabase** 🦕 MODERN
```
Frontend: Deno Deploy (100k requests/month)
Database: Supabase
```
- **Cost:** $0-20/month
- **Why:** TypeScript-native, modern, fast
- **Tradeoff:** Smaller ecosystem

**Option 4: Railway + PostgreSQL** 🚂 SIMPLE
```
Everything: Railway ($5 credits/month free)
```
- **Why:** One platform for everything
- **Tradeoff:** Free credits run out faster

**Option 5: Firebase** 🔥 ALL-IN-ONE
```
Everything: Firebase (very generous Spark plan)
```
- **Why:** All services included, great mobile SDK
- **Tradeoff:** Vendor lock-in, NoSQL only

**Recommendation:** **Netlify + Supabase** - balanced, great DX, you know Netlify, can scale.

---

## Technical Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Life Organizer (React)                    │
│                                                              │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────┐         │
│  │ Dashboard  │  │ Task Manager │  │ Calendar    │         │
│  └────────────┘  └──────────────┘  └─────────────┘         │
│                                                              │
│  ┌────────────────────────────────────────────────┐        │
│  │   AI Recommendation Engine (Claude API)        │        │
│  └────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Protocol Layer                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Calendar MCP │  │  Gmail MCP   │  │  Beads MCP   │     │
│  │  (Google)    │  │  (Google)    │  │   (Local)    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │  Drive MCP   │  │  Zapier MCP  │  (extensible)          │
│  │  (Google)    │  │  (5000+apps) │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   External Services                          │
│                                                              │
│  Google Calendar  │  Gmail  │  Beads CLI  │  Google Drive   │
└─────────────────────────────────────────────────────────────┘
```

### Data Architecture

**Phase 1 (Artifact Mode):**
```javascript
// All data in browser
window.storage.set('tasks', JSON.stringify(tasks));
window.storage.set('preferences', JSON.stringify(prefs));
```

**Phase 2 (Production):**
```sql
-- Supabase PostgreSQL
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  title TEXT NOT NULL,
  category TEXT,
  priority TEXT CHECK (priority IN ('high', 'medium', 'low')),
  time_required INTEGER, -- hours
  deadline TIMESTAMP,
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed')),
  source TEXT, -- 'manual', 'beads', 'imported'
  external_id TEXT, -- Beads ID if from Beads
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users,
  notification_email BOOLEAN DEFAULT true,
  notification_sms BOOLEAN DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE memories (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  memory TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### MCP Integration Layer

**Beads MCP Server (To Be Built):**
```typescript
// beads-mcp-server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const server = new Server({
  name: 'beads-mcp',
  version: '1.0.0'
});

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'bd_ready',
      description: 'Get Beads tasks with no blockers',
      inputSchema: {
        type: 'object',
        properties: {
          project_path: { type: 'string', description: 'Path to Beads project' }
        },
        required: ['project_path']
      }
    },
    {
      name: 'bd_list',
      description: 'List all Beads tasks',
      inputSchema: {
        type: 'object',
        properties: {
          project_path: { type: 'string' },
          status: { type: 'string', enum: ['open', 'in_progress', 'closed'] }
        },
        required: ['project_path']
      }
    },
    {
      name: 'bd_show',
      description: 'Show detailed Beads task information',
      inputSchema: {
        type: 'object',
        properties: {
          project_path: { type: 'string' },
          task_id: { type: 'string' }
        },
        required: ['project_path', 'task_id']
      }
    },
    {
      name: 'bd_claim',
      description: 'Atomically claim a Beads task',
      inputSchema: {
        type: 'object',
        properties: {
          project_path: { type: 'string' },
          task_id: { type: 'string' }
        },
        required: ['project_path', 'task_id']
      }
    },
    {
      name: 'bd_close',
      description: 'Close a Beads task with reason',
      inputSchema: {
        type: 'object',
        properties: {
          project_path: { type: 'string' },
          task_id: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['project_path', 'task_id', 'reason']
      }
    }
  ]
}));

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;
  const projectPath = args.project_path;
  
  try {
    let command = '';
    
    switch (name) {
      case 'bd_ready':
        command = `cd ${projectPath} && bd ready --json`;
        break;
      case 'bd_list':
        command = `cd ${projectPath} && bd list --json ${args.status ? `--status=${args.status}` : ''}`;
        break;
      case 'bd_show':
        command = `cd ${projectPath} && bd show ${args.task_id} --json`;
        break;
      case 'bd_claim':
        command = `cd ${projectPath} && bd update ${args.task_id} --claim --json`;
        break;
      case 'bd_close':
        command = `cd ${projectPath} && bd close ${args.task_id} "${args.reason}" --json`;
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    
    const { stdout } = await execAsync(command);
    
    return {
      content: [
        { type: 'text', text: stdout }
      ]
    };
  } catch (error) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: error.message }) }
      ],
      isError: true
    };
  }
});

server.connect(/* transport config */);
```

**Life Organizer MCP Client:**
```javascript
// In React artifact or Netlify function
async function getRecommendations() {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Analyze my schedule and tasks. Give me today's smart recommendations.
        
Current time: ${new Date().toISOString()}

Instructions:
1. Check my calendar for today's events
2. Get my pending tasks from storage
3. Get Beads tasks from my projects
4. Identify urgent items (deadlines within 3 days)
5. Match tasks to free time blocks
6. Return recommendations in JSON format`
      }],
      mcp_servers: [
        {
          type: 'url',
          url: 'https://calendarmcp.googleapis.com/mcp/v1',
          name: 'google-calendar'
        },
        {
          type: 'url',
          url: 'https://gmailmcp.googleapis.com/mcp/v1',
          name: 'gmail'
        },
        {
          type: 'command',
          command: 'beads-mcp',
          args: ['--project', '/Users/mo/projects/tarim-shaiel-campaign-frame'],
          name: 'beads-tarim'
        }
      ]
    })
  });
  
  const data = await response.json();
  return parseRecommendations(data);
}
```

---

## Integration Strategy

### Beads CLI Integration - Detailed Plan

**Phase 1: Discovery & Registration (Week 1)**

1. **Check for Existing Beads MCP Server**
   ```bash
   npm search beads-mcp
   # or
   tool_search("beads task tracker mcp")
   ```

2. **If Not Found: Build Minimal Beads MCP**
   - ~50 lines of TypeScript (see architecture section)
   - Expose 5 core tools: ready, list, show, claim, close
   - Test with Claude Desktop
   - Publish to npm as `@life-organizer/beads-mcp`

3. **Registration Mechanism**
   ```bash
   # After bd init in any project
   life-organizer register-beads
   
   # Creates entry in ~/.config/life-organizer/beads-projects.json
   # Or better: adds MCP server to Claude.ai config
   ```

**Phase 2: Read-Only Integration (Week 2)**

1. **Dashboard Display**
   ```jsx
   <BeadsTasksSection>
     <h3>Beads Projects</h3>
     {beadsProjects.map(project => (
       <ProjectCard key={project.id}>
         <h4>{project.nickname}</h4>
         {project.tasks.map(task => (
           <TaskCard
             id={task.id}
             title={task.title}
             priority={task.priority}
             blockedBy={task.blocked_by}
             estimatedTime={aiEstimate(task)}
           />
         ))}
       </ProjectCard>
     ))}
   </BeadsTasksSection>
   ```

2. **AI Time Estimation**
   ```javascript
   async function estimateBeadsTaskTime(task) {
     const prompt = `Estimate hours needed for this task:
     
Title: ${task.title}
Type: ${task.type}
Design: ${task.design_doc || 'No design doc'}

Respond with just a number 1-8 representing hours.`;
     
     const response = await callClaude(prompt);
     return parseInt(response.trim());
   }
   ```

3. **Include in Recommendations**
   ```javascript
   // Life Organizer calls Claude with context:
   const context = {
     calendar_events: await getCalendarEvents(),
     my_tasks: await getMyTasks(),
     beads_tasks: await getBeadsTasks(),
     current_time: new Date().toISOString()
   };
   
   const recommendations = await claude.analyze(context);
   // Claude sees Beads tasks and can recommend them
   ```

**Phase 3: Quick Actions (Week 3-4)**

1. **Claim Button**
   ```jsx
   <button onClick={() => claimBeadsTask(task.id, task.project_path)}>
     Claim Task
   </button>
   
   async function claimBeadsTask(taskId, projectPath) {
     await mcpClient.call('beads-mcp', 'bd_claim', {
       project_path: projectPath,
       task_id: taskId
     });
     
     // Refresh task list
     refreshBeadsTasks();
   }
   ```

2. **Close Button**
   ```jsx
   <button onClick={() => promptCloseTask(task)}>
     Mark Complete
   </button>
   
   async function promptCloseTask(task) {
     const reason = prompt('Close reason:');
     if (!reason) return;
     
     await mcpClient.call('beads-mcp', 'bd_close', {
       project_path: task.project_path,
       task_id: task.id,
       reason: reason
     });
     
     refreshBeadsTasks();
   }
   ```

---

### Calendar Integration

**Google Calendar MCP (Already Exists):**
```javascript
// Just use existing MCP - no custom code needed!
const events = await mcpClient.call('google-calendar', 'list_events', {
  calendar_id: 'primary',
  time_min: new Date().toISOString(),
  time_max: endOfDay.toISOString()
});

// Calculate free time blocks
const freeBlocks = calculateFreeTime(events);
```

**Apple Calendar (Future):**
- AppleScript integration via "Control your Mac" MCP
- Or wait for official Apple Calendar MCP

---

### Notification System

**Email via Gmail MCP:**
```javascript
async function sendEmailNotification(user, recommendation) {
  await mcpClient.call('gmail', 'send_message', {
    to: user.email,
    subject: '🎯 Life Organizer: Priority Recommendation',
    body: `
Hi ${user.name},

${recommendation.message}

Suggested action: ${recommendation.action}

Based on your schedule analysis at ${new Date().toLocaleTimeString()}
    `
  });
}
```

**SMS via Zapier MCP:**
```javascript
// Zapier MCP connects to 5000+ apps including Twilio
async function sendSMSNotification(user, urgentTask) {
  await mcpClient.call('zapier', 'run_zap', {
    zap_id: 'sms-urgent-notification',
    data: {
      phone: user.phone,
      message: `🚨 ${urgentTask.title} - deadline in ${urgentTask.daysLeft} days!`
    }
  });
}
```

---

## Deployment Model

### Phase 1: Artifact (Week 1-2)

**Deployment:**
```
User opens: https://claude.ai
Opens Life Organizer artifact
All runs client-side in browser
```

**Pros:**
- ✅ Zero deployment complexity
- ✅ Zero hosting costs
- ✅ Uses user's existing MCP connections
- ✅ Instant updates (edit artifact)

**Cons:**
- ⚠️ No background jobs
- ⚠️ No cross-device sync (unless we use Drive MCP)
- ⚠️ Requires Claude.ai session open

**User Experience:**
1. User ensures MCPs connected (Calendar, Gmail)
2. Opens Life Organizer in Claude.ai
3. Sees unified dashboard
4. Gets AI recommendations

---

### Phase 2: PWA (Week 3-5)

**Deployment:**
```
Hosted: https://life-organizer.netlify.app
Installable as PWA on desktop/mobile
Service worker for offline support
```

**Architecture:**
```
Netlify Hosting (Static Site)
  ├─ React App (builds to /dist)
  ├─ Service Worker (offline caching)
  └─ netlify/functions/ (Serverless)
      ├─ get-recommendations.js
      ├─ sync-calendar.js
      └─ send-notifications.js
```

**Netlify Functions:**
```javascript
// netlify/functions/get-recommendations.js
import { createClient } from '@supabase/supabase-js';

export async function handler(event, context) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  
  const userId = event.queryStringParameters.userId;
  
  // Get user's tasks from Supabase
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId);
  
  // Call Claude with MCP servers
  const recommendations = await callClaudeWithMCP({
    tasks,
    userId,
    mcpServers: [
      { type: 'url', url: 'https://calendarmcp.googleapis.com/mcp/v1' },
      { type: 'url', url: 'https://gmailmcp.googleapis.com/mcp/v1' }
    ]
  });
  
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recommendations)
  };
}
```

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

# PWA Configuration
[[headers]]
  for = "/manifest.json"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
    
[[headers]]
  for = "/service-worker.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

# Environment Variables (set in Netlify dashboard)
# SUPABASE_URL
# SUPABASE_ANON_KEY
# ANTHROPIC_API_KEY
```

**Supabase Setup:**
```sql
-- Run in Supabase SQL Editor

-- Enable Row Level Security
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own tasks
CREATE POLICY "Users can view own tasks"
  ON tasks
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own tasks
CREATE POLICY "Users can insert own tasks"
  ON tasks
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own tasks
CREATE POLICY "Users can update own tasks"
  ON tasks
  FOR UPDATE
  USING (auth.uid() = user_id);
```

---

### Phase 3: Enhanced Backend (Month 2-3)

**Additional Features:**
- Background task checking (cron jobs)
- Webhook receivers (calendar change notifications)
- Cached recommendations (reduce Claude API calls)
- Multi-user support (if needed)

**Netlify Scheduled Functions:**
```javascript
// netlify/functions/scheduled/check-urgent-tasks.js
// Runs every hour via Netlify cron

export async function handler(event, context) {
  const supabase = createClient(/* ... */);
  
  // Find tasks with deadlines in next 24 hours
  const { data: urgentTasks } = await supabase
    .from('tasks')
    .select('*, users(email, phone)')
    .gte('deadline', new Date())
    .lte('deadline', new Date(Date.now() + 24 * 60 * 60 * 1000))
    .eq('status', 'pending');
  
  // Send notifications
  for (const task of urgentTasks) {
    await sendEmailNotification(task);
    if (task.users.sms_enabled) {
      await sendSMSNotification(task);
    }
  }
  
  return { statusCode: 200 };
}
```

---

## Implementation Phases

### Phase 0: Foundation (Days 1-2)

**Deliverables:**
- ✅ Repository structure created
- ✅ This ARD document
- ✅ Implementation plan (plan.md)
- ✅ README.md
- ✅ .gitignore configured
- ✅ Beads initialized in repo

**Tasks:**
1. Create `/Users/mo/Code/life-organizer` directory
2. Initialize git repository
3. Run `bd init` in project root
4. Create `.notes/` directory for documentation
5. Write ARD (this document)
6. Write implementation plan
7. Push to GitHub

---

### Phase 1: Working MVP Artifact (Week 1)

**Goal:** Functional Life Organizer running in Claude.ai

**Deliverables:**
- ✅ React artifact with basic UI
- ✅ Task management (CRUD) with clean forms
- ✅ Mock calendar display
- ✅ Basic recommendation engine
- ✅ window.storage persistence

**Tasks:**
1. Fix form focus issues (use FormData, not controlled inputs)
2. Build task dashboard UI
3. Implement simple recommendation algorithm
4. Add calendar event display (mock data)
5. Test in Claude.ai artifact environment

**Success Criteria:**
- Can add tasks without form breaking
- Recommendations appear based on mock data
- Data persists across browser refreshes

---

### Phase 2: MCP Integration (Week 2)

**Goal:** Replace mock data with real MCP calls

**Deliverables:**
- ✅ Google Calendar integration via MCP
- ✅ Gmail notification capability
- ✅ Beads MCP server (built or found)
- ✅ Real-time calendar data in dashboard

**Tasks:**
1. Search for existing Beads MCP server
2. If not found: Build minimal Beads MCP (~2 days)
3. Integrate Calendar MCP
4. Test with real calendar data
5. Add Beads task display
6. AI time estimation for Beads tasks

**Success Criteria:**
- Shows real calendar events from Google
- Displays Beads tasks with AI time estimates
- Recommendations based on actual free time

---

### Phase 3: PWA Deployment (Week 3)

**Goal:** Deploy to Netlify as installable PWA

**Deliverables:**
- ✅ Netlify deployment
- ✅ PWA manifest and service worker
- ✅ Supabase database setup
- ✅ Netlify Functions for backend logic

**Tasks:**
1. Create Netlify project
2. Configure build settings
3. Set up Supabase database
4. Migrate window.storage to Supabase
5. Add PWA manifest
6. Implement service worker for offline
7. Deploy to production

**Success Criteria:**
- Installable on desktop/mobile
- Works offline with cached data
- Data syncs across devices

---

### Phase 4: Enhanced Features (Week 4-5)

**Goal:** Notification system and Beads actions

**Deliverables:**
- ✅ Email notifications via Gmail MCP
- ✅ SMS notifications via Zapier MCP (optional)
- ✅ Beads "Claim" and "Close" buttons
- ✅ Scheduled background checks

**Tasks:**
1. Implement email notification sending
2. Add "Claim Task" functionality for Beads
3. Add "Mark Complete" for Beads tasks
4. Set up Netlify scheduled functions
5. Test notification triggers

**Success Criteria:**
- Receives email for urgent deadlines
- Can claim Beads tasks from UI
- Background job checks for urgent items

---

### Phase 5: Polish & Optional Features (Week 6+)

**Goal:** User experience improvements and future features

**Deliverables:**
- ⚠️ Team features (if needed)
- ⚠️ Apple Calendar integration (if demanded)
- ⚠️ Dependency graph visualization
- ⚠️ Mobile app (if PWA insufficient)

**Tasks:**
- Evaluate user feedback
- Prioritize most-requested features
- Consider native app if PWA limitations become blockers

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **MCP server unavailability** | Medium | High | Graceful degradation, cached data, retry logic |
| **Anthropic API costs** | Medium | Medium | Smart batching, user limits, caching |
| **Beads schema changes** | Low | Medium | Version checking, compatibility warnings |
| **Browser storage limits** | Medium | Low | Migrate to cloud storage in Phase 2 |
| **MCP protocol changes** | Low | High | Follow MCP specification updates |

### Product Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Notification fatigue** | High | Medium | Conservative defaults, user learning |
| **Complexity creep** | High | High | Strict MVP scope, defer features |
| **Beads adoption barrier** | Medium | Medium | Make Beads integration optional |
| **User doesn't have MCPs** | Medium | High | Provide setup guides, fallback to manual entry |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Limited user base** | Medium | Low | Start personal use, open source if popular |
| **API costs exceed budget** | Low | Medium | Monitor usage, implement rate limits |
| **Maintenance burden** | Medium | Medium | Keep architecture simple, use managed services |

---

## Decision Log

### Decision 1: MCP-First Architecture
**Date:** 2026-05-16  
**Decision:** Use MCP protocol for all external integrations instead of custom backends  
**Rationale:** Eliminates 70-80% of integration code, leverages existing MCP servers, future-proof  
**Alternatives Rejected:** Custom API wrappers, direct API integration  
**Status:** Approved

### Decision 2: Netlify + Supabase Stack
**Date:** 2026-05-16  
**Decision:** Use Netlify for hosting, Supabase for database  
**Rationale:** User already has Netlify relationship, both have generous free tiers, good DX  
**Alternatives Considered:** Cloudflare (more generous but more complex), Firebase (vendor lock-in)  
**Status:** Approved

### Decision 3: Read-Only Beads Integration
**Date:** 2026-05-16  
**Decision:** Integrate Beads as read-only with quick actions (claim, close)  
**Rationale:** Preserves Beads workflow, low complexity, adds AI layer on top  
**Alternatives Rejected:** Full bidirectional sync (too complex), migration path (loses Beads features)  
**Status:** Approved

### Decision 4: PWA over Native Apps
**Date:** 2026-05-16  
**Decision:** Build PWA first, evaluate native apps later  
**Rationale:** 1 week vs 8-12 weeks, cross-platform, easier maintenance  
**Alternatives Deferred:** Electron (if demand), Native Swift (if App Store needed)  
**Status:** Approved

### Decision 5: AI Time Estimation for Beads
**Date:** 2026-05-16  
**Decision:** Use Claude to estimate time for Beads tasks (which lack time data)  
**Rationale:** Beads tasks have no deadline/time fields, critical for recommendations  
**Alternatives Considered:** User prompts (annoying), default heuristics (inaccurate)  
**Status:** Approved

### Decision 6: Local Vite Dev First, Then Netlify PWA
**Date:** 2026-05-16  
**Decision:** Build as a local Vite + React app from day one, deploy to Netlify as PWA  
**Rationale:** Claude.ai artifacts run in a sandboxed iframe with no filesystem access — they can't connect to local MCP servers or read local Beads databases, which are core Phase 2 requirements. A local dev server costs nothing and is the right foundation for the full architecture.  
**Alternatives Rejected:**  
- Claude.ai artifact first: appealing for zero-setup demos but is a dead end — cannot access local files, MCP servers, or anything outside the browser sandbox  
- Next.js: optimized for Vercel + SSR, neither of which we need; fighting it to deploy static files to Netlify adds friction  
**Status:** Supersedes original "artifact first" decision. Approved 2026-05-16.

---

### Decision 7: Source as Context — No Manual Classification
**Date:** 2026-05-16  
**Decision:** Use `source` (beads | email | calendar | manual) as the primary differentiator between task types. No manual "context" or "work vs. personal" field.  
**Rationale:** There are two fundamentally different kinds of items in a life organizer:
- **Process tasks** — structured work belonging to a larger project/workflow (e.g. building a feature, filing a bug). Beads models these; they have dependencies, states, and belong to a system.
- **Life tasks** — one-off actions arising from events (answer an email, run an errand, RSVP to a dinner). Ephemeral, event-driven, don't belong to a project.

The source field captures this distinction automatically, without asking the user to categorize anything. A task that came from Beads is a process task. A task that came from email is a life task. A manually entered task is assumed to be a life task. This enables future "discovery" — when MCP integrations pull from Gmail, Calendar, and Beads, the source is set automatically.  
**Alternatives Rejected:**  
- Manual `context` field (work/personal): requires user effort on every task; wrong axis anyway (a personal errand vs. a Beads engineering task is source-driven, not a user label)  
- Category field as differentiator: too fine-grained, still manual  
**Data model:** each task has `source: 'manual' | 'beads' | 'email' | 'calendar'` and `sourceUrl: string | null` (deep link back to origin). Set at creation time by the integration that produced the task.  
**Status:** Approved 2026-05-16.

---

## Open Questions

### Critical (Must Resolve Before Implementation)

1. **Does Beads MCP server already exist?**
   - **Action:** Search npm, GitHub, MCP registry
   - **Timeline:** Before Week 2
   - **Owner:** Mo + Claude

2. **What's the Anthropic API budget?**
   - **Context:** Heavy Claude usage for recommendations
   - **Action:** Estimate costs per user per month, set limits
   - **Timeline:** Before Phase 2
   - **Owner:** Mo

3. **Do we need multi-user support?**
   - **Context:** Affects auth, database, deployment complexity
   - **Action:** Decide if this is personal tool or product
   - **Timeline:** Before Phase 3
   - **Owner:** Mo

### Important (Resolve During Implementation)

4. **How often to poll for calendar/Beads changes?**
   - **Options:** Every 30s, every 5 min, on user action only
   - **Tradeoff:** Freshness vs API costs
   - **Timeline:** During Phase 2

5. **What's the AI estimation accuracy?**
   - **Context:** Claude estimating Beads task time from titles
   - **Action:** Test with real tasks, validate with Mo's experience
   - **Timeline:** During Phase 2

6. **Should we persist AI-generated estimates?**
   - **Context:** Re-estimating on every load costs API calls
   - **Action:** Cache estimates, allow user override
   - **Timeline:** During Phase 2

### Nice to Have (Defer Until Later)

7. **Apple Calendar integration priority?**
   - **Context:** AppleScript works but macOS-only
   - **Action:** Survey users, decide if worth effort
   - **Timeline:** After Phase 5

8. **Team coordination features?**
   - **Context:** Requires multi-user backend, shared calendars
   - **Action:** Evaluate demand after personal use validation
   - **Timeline:** Month 3+

9. **Mobile native app?**
   - **Context:** PWA works but iOS has limitations
   - **Action:** Evaluate PWA limitations in practice
   - **Timeline:** After PWA deployed

---

## Appendices

### A. Technology Stack Summary

**Frontend:**
- React (artifact or standalone)
- Tailwind CSS (styling)
- Lucide React (icons)

**Backend:**
- Netlify Functions (serverless)
- Supabase PostgreSQL (database)
- Anthropic API (AI recommendations)

**Integrations:**
- MCP Protocol (all external services)
- Google Calendar MCP
- Gmail MCP
- Google Drive MCP (optional)
- Beads MCP (to be built)
- Zapier MCP (for SMS, optional)

**Infrastructure:**
- Netlify (hosting, CDN, functions)
- Supabase (database, auth, storage)
- GitHub (code, CI/CD)

### B. Key Dependencies

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@supabase/supabase-js": "^2.45.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "lucide-react": "latest"
  },
  "devDependencies": {
    "@modelcontextprotocol/sdk": "^0.6.0",
    "vite": "^5.0.0",
    "typescript": "^5.6.0"
  }
}
```

### C. Environment Variables

**Production (.env):**
```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your-key

# Optional: Zapier
ZAPIER_API_KEY=your-zapier-key
```

**Development (.env.local):**
```bash
# Use Supabase local dev
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=local-dev-key

# Test API key
ANTHROPIC_API_KEY=sk-ant-test-key
```

### D. MCP Server Configuration

**~/.config/claude/config.json** (for Claude Desktop):
```json
{
  "mcpServers": {
    "google-calendar": {
      "type": "url",
      "url": "https://calendarmcp.googleapis.com/mcp/v1"
    },
    "gmail": {
      "type": "url",
      "url": "https://gmailmcp.googleapis.com/mcp/v1"
    },
    "google-drive": {
      "type": "url",
      "url": "https://drivemcp.googleapis.com/mcp/v1"
    },
    "beads-tarim": {
      "command": "beads-mcp",
      "args": ["--project", "/Users/mo/projects/tarim-shaiel-campaign-frame"]
    },
    "beads-work": {
      "command": "beads-mcp",
      "args": ["--project", "/Users/mo/work/comcast-ai-adoption"]
    }
  }
}
```

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-05-16 | Mo + Claude | Initial ARD from complete discussion transcript |

---

**End of Architecture Requirements Document**
