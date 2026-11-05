# SafetyAudit — Child Safety Compliance Platform

A full-stack web application for conducting structured compliance audits of social media platforms against child safety regulatory frameworks (e.g. eSafety AU, MY PDPA, ONSA Child Protection Code).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Vite |
| Styling | Tailwind CSS v3, Framer Motion |
| State | Zustand |
| Routing | React Router v6 |
| Icons | Phosphor Icons |
| Backend | Node.js + Express (TypeScript) |
| Database | Supabase (PostgreSQL) |
| AI Generator | Groq API — Llama 3.3 70B |
| AI Evidence Assessment | Playwright (Chromium) page capture + Groq API |
| Tests | Vitest (unit, integration), Playwright Test (browser end-to-end) |

---

## Project Structure

```
Social-Media-Auditor/
├── frontend/                   ← Vite + React app
│   └── src/
│       ├── features/
│       │   ├── audits/         ← AuditPage (checklist interface)
│       │   ├── auth/           ← Login, Register
│       │   ├── dashboard/      ← Dashboard overview
│       │   ├── evidence/       ← AI evidence panel, suggestion cards, accept/override
│       │   ├── generator/      ← AI guideline generator (Admin)
│       │   ├── guidelines/     ← Browse compliance frameworks
│       │   ├── projects/       ← Project list + create audit
│       │   └── reports/        ← Submission reports + compliance scores
│       ├── hooks/
│       │   └── useProjectData.ts
│       ├── layouts/            ← AppLayout, Sidebar, ProtectedRoute
│       ├── lib/
│       │   ├── db.ts           ← REST API client
│       │   └── supabase.ts     ← Supabase auth client
│       ├── store/
│       │   └── useStore.ts     ← Zustand global store
│       └── types/
│           └── index.ts
│   ├── e2e/                    ← Browser end-to-end tests (Playwright, network stubbed)
│   └── playwright.config.ts
└── backend/                    ← Express REST API
    ├── supabase/migrations/    ← SQL to run by hand (001_evidence_assessment.sql)
    └── src/
        ├── server.ts           ← All API routes
        ├── features/evidence/  ← AI evidence assessment: capture, assessment, decisions, routes
        ├── services/
        │   └── dbService.ts    ← Supabase queries + RPC calls
        └── config/
            └── supabase.ts
```

---

## Getting Started

### Prerequisites

- **Node.js** v18+
- **npm** v9+

### 1. Clone the repository

```bash
git clone <repo-url>
cd Social-Media-Auditor
```

### 2. Set up environment variables

**`backend/.env`**
```env
PORT=3000
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
GROQ_API_KEY=your_groq_api_key        # Required for AI generator only
GROQ_MODEL=llama-3.3-70b-versatile
```

**`frontend/.env`**
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_API_URL=http://localhost:3000/api
```

### 3. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 4. Start both servers

**Terminal 1 — Backend** (http://localhost:3000)
```bash
cd backend && npm run dev
```

**Terminal 2 — Frontend** (http://localhost:5173)
```bash
cd frontend && npm run dev
```

---

## User Roles

| Role | Permissions |
|---|---|
| **Admin** | Manage global guidelines, run AI generator. No access to audit projects. |
| **Head Auditor** | Create and delete audit projects, assign auditors, configure guidelines and scope per project, enable/disable checklist categories, review and approve/reject submissions. |
| **Auditor** | Answer checklist items, record findings and notes, upload evidence, submit completed audits for review. |

---

## Pages & Access

| Route | Page | Access |
|---|---|---|
| `/` | Login | Public |
| `/register` | Register | Public |
| `/dashboard` | Dashboard | All roles |
| `/projects` | Audit Projects | Head Auditor, Auditor |
| `/projects/new` | Create Audit | Head Auditor |
| `/projects/:id` | Audit Detail | Head Auditor, Auditor |
| `/guidelines` | Guidelines | Admin, Head Auditor |
| `/generator` | AI Generator | Admin |
| `/reports` | Reports | Head Auditor, Auditor |

---

## Audit Workflow

```
Create Project → in_progress → (Auditor submits) → under_review → (Head Auditor reviews) → completed
                                                                 ↘ (Rejected) → in_progress
```

1. **Head Auditor** creates a project: selects platform, regulatory guidelines, assigns auditors, sets due date and scope
2. **Auditors** work through checklist items organised by guideline and category
3. Each item supports: **Yes / No / Partially / N/A** responses, a **Flag** for items needing follow-up, findings text, and evidence image uploads
4. Each item has a **Help** panel (audit guidance) and **Traceability** tab (verbatim regulatory clause + clause reference)
5. Once all enabled items are answered, the auditor submits for review
6. **Head Auditor** approves or rejects the submission with remarks
7. Approved submissions appear in **Reports** with a full compliance breakdown

---

## Compliance Scoring

Scores are computed per project from auditor responses:

| Response | Weight |
|---|---|
| Yes (Compliant) | 1.0 |
| Partially | 0.5 |
| No (Non-compliant) | 0.0 |
| N/A | Excluded from denominator |
| Not started / Flagged | Excluded |

```
Score = (compliant × 1.0 + partially × 0.5) / applicable items × 100
```

Color thresholds: **≥ 80%** emerald · **≥ 60%** amber · **< 60%** rose

---

## AI Evidence Assessment

An auditor gives the project one or more public website links. The server opens those pages in a headless browser, reads what a visitor could see, takes screenshots, and asks an AI model (Groq) to suggest an answer for each checklist item, with a short reason and quotes from the pages. The auditor then reviews every suggestion.

### What it does and does not do

- **A suggestion never changes an answer or the compliance score.** Only an auditor pressing **Accept** or **Override** does. Accepting writes the AI's answer, uses its reason as the findings when the auditor has written none, and adds the captured screenshot to the photos. Nothing the auditor already wrote or attached is replaced. Overriding asks for a reason and takes the auditor's own answer. The Head Auditor sees on each item, and in Reports, whether an answer was accepted from the AI, overridden, or entered by hand.
- Suggestions the AI is unsure about carry a blue **Needs human review** chip with its reason. This is separate from the auditor's own amber **Flag**. **Flagged by AI only** narrows the list to those items.
- **If the AI fails, nothing is guessed.** A category the AI could not assess is listed as "not assessed", and **Re-assess unfinished** runs just those again.
- `robots.txt` is respected. Only a Head Auditor can record that the platform gave permission to skip it (a tick box and a note on the panel).
- No captcha solving and no getting around blocks. A page that needs a login, or that blocks the server, is reported as one that could not be read.
- Only the auditor roles see the panel. It is locked, like the answers, once an audit is submitted for review or approved.

### Limits

All set in `backend/src/features/evidence/config.ts`:

| Limit | Value |
|---|---|
| Pages per run (links one level deep from the start links are followed) | 30 |
| Start links per project | 10 |
| Time per page / per whole run | 30 s / 15 min |
| Runs per project per day | 5 |
| Runs at the same time | 1 (others wait in a queue) |
| AI tokens per run | 80 000 |

### Setup

1. **Environment variables** in `backend/.env`:

   ```env
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key   # server only, never in the frontend
   SESSION_SECRET=a_random_string_of_at_least_32_characters
   GROQ_API_KEY=your_groq_api_key                    # already used by the generator
   GROQ_MODEL=llama-3.3-70b-versatile                # optional
   BROWSER_WS_ENDPOINT=http://host:9222              # optional: use a browser you run yourself
   EVIDENCE_ALLOWED_PRIVATE_HOSTS=localhost:8080     # optional: comma-separated, for local test sites only
   ```

   Until `SUPABASE_SERVICE_ROLE_KEY` and `SESSION_SECRET` are both set, the evidence routes answer 503 and the panel says the service is unavailable. The rest of the app keeps working. Without `GROQ_API_KEY`, existing suggestions can be read but runs cannot start. A `SESSION_SECRET` shorter than 32 characters stops the server from starting.

2. **Apply the database migration.** Open the Supabase SQL editor and run `backend/supabase/migrations/001_evidence_assessment.sql`. Run the pre-check from the comment at the top of that file first: it shows whether `projectId`, `itemId` and `userId` are `uuid` columns, which the migration assumes. The migration creates the evidence tables with row level security and no policies (only the server's service role can reach them), a search function, and a private `evidence-screenshots` storage bucket.

3. **Install the capture browser**, in `backend/` (that is where pages are captured):

   ```bash
   cd backend && npx playwright install chromium
   ```

   A browser you run yourself and reach through `BROWSER_WS_ENDPOINT` must be started with the flags in `LOCKED_DOWN_BROWSER_ARGS` (`backend/src/features/evidence/browser.ts`). They take the network away from the browser itself, so a page cannot reach an internal address through it.

4. Sign out and in again once the server is configured. Evidence calls use a session token issued at login by `/api/auth/login`.

### Known limits

- Public webpage text only. Nothing behind a login, no test accounts, no app screens.
- Links to PDFs and other files are not followed.
- Text inside closed shadow roots is not read (open ones are).
- Hidden text is filtered out by a heuristic (display, visibility, size, opacity and similar). It catches the common tricks, not every possible one.
- A close-up of a quote is left out when the quote cannot be boxed truthfully on the page. The full-page screenshot is shown instead.
- DNS rebinding and very large compressed responses are accepted residual risks in this version.
- The older API routes (projects, results and so on) still trust the user id the browser sends. Only the evidence routes check the session token.
- **Page text is sent to Groq**, with the checklist item wording. Do not point the feature at pages you may not share with it.

---

## Tests

```bash
npm test --prefix backend            # unit and integration tests
npm test --prefix frontend           # component and hook tests (Vitest, jsdom)
npm run test:e2e --prefix frontend   # browser end-to-end tests (Playwright)
```

The end-to-end tests start Vite on port 5199 and stub every `/api` call and every Supabase call in the browser, so they need no database, keys or network. Install the browser once with `npx playwright install chromium` in `frontend/` (or reuse the one already installed for the backend). They cover running an assessment, accepting and overriding, the Head Auditor's provenance labels, the flagged filter, and a 503 from the evidence API.

---

## Supported Platforms

TikTok, Instagram, Facebook, Snapchat, YouTube, Discord, X (Twitter), and **Other** (custom input).

---

## Data Model

| Table | Purpose |
|---|---|
| `User` | Users and roles (`admin`, `head_auditor`, `auditor`) |
| `Audit_Project` | Audit projects with status and submission tracking |
| `Guideline` | Compliance frameworks (global templates + project-specific copies) |
| `Checklist` | Links a guideline copy to a project |
| `Checklist_Item` | Individual audit items with clause code, help text, traceability, severity |
| `Audit_Result` | Auditor responses (result, findings, notes) per item per project |
| `Compliance_Score` | Computed scores per guideline per project |
| `Project_Member` | Project ↔ user membership |
| `Project_Guideline` | Project ↔ guideline assignment |
| `Evidence_Source`, `Evidence_Permission`, `Evidence_Run`, `Evidence_Page`, `Evidence_Passage` | AI evidence assessment: links, robots.txt permission, runs, captured pages and their text |
| `AI_Suggestion`, `AI_Suggestion_Quote`, `AI_Suggestion_Decision` | AI suggestions, their quotes, and each auditor's accept or override |

---

## Useful Commands

```bash
# Type-check frontend
cd frontend && npx tsc --noEmit

# Type-check backend
cd backend && npx tsc --noEmit

# Build frontend for production
cd frontend && npm run build

# Browser end-to-end tests
cd frontend && npm run test:e2e
```
