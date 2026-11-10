# SafetyAudit: Child Safety Compliance Platform

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
| AI Generator | Groq API (`GROQ_MODEL`, Llama) |
| AI Evidence Assessment | Playwright (Chromium) page capture + Groq API (`EVIDENCE_GROQ_MODEL`, gpt-oss-120b) |
| Auth | JWT bearer token from `POST /api/auth/login`, signed with `JWT_SECRET` |
| Email | Brevo (project assignment notifications) |
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
GROQ_API_KEY=your_groq_api_key        # Required for the AI features
GROQ_MODEL=llama-3.1-8b-instant       # Model for the generator and the other general AI features
BREVO_API_KEY=your_brevo_api_key      # Project assignment emails
BREVO_SENDER_EMAIL=your_verified_sender_email
JWT_SECRET=a_long_random_string       # Signs login tokens; at least 32 characters (see below)
```

`JWT_SECRET` is required: the server refuses to start without it. Generate one with
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. The AI evidence routes
accept the same login token; they turn themselves off (and answer 503) if the secret is shorter than
32 characters. The AI evidence feature has its own optional variables, listed under its setup below.

| Variable | Used by | Default |
|---|---|---|
| `GROQ_MODEL` | Generator and the other general AI features | `llama-3.3-70b-versatile` in code; `.env.example` sets `llama-3.1-8b-instant` |
| `EVIDENCE_GROQ_MODEL` | AI evidence assessment only (needs `reasoning_effort` and JSON mode) | `openai/gpt-oss-120b` |
| `JWT_SECRET` | Login tokens for every protected route, including the evidence routes | none: required |

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

**Terminal 1: Backend** (http://localhost:3000)
```bash
cd backend && npm run dev
```

**Terminal 2: Frontend** (http://localhost:5173)
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
   JWT_SECRET=a_random_string_of_at_least_32_characters  # the app's login secret, shared with the evidence routes
   GROQ_API_KEY=your_groq_api_key                    # already used by the generator
   EVIDENCE_GROQ_MODEL=openai/gpt-oss-120b           # optional: this is the default; GROQ_MODEL is not used here
   EVIDENCE_SECRET_KEY=base64_of_32_random_bytes     # only for checking inside the app (see below)
   BROWSER_WS_ENDPOINT=http://host:9222              # optional: use a browser you run yourself
   EVIDENCE_ALLOWED_PRIVATE_HOSTS=localhost:8080     # optional: comma-separated, for local test sites only
   ```

   Until `SUPABASE_SERVICE_ROLE_KEY` is set and `JWT_SECRET` is at least 32 characters, the evidence routes answer 503, the panel says the service is unavailable, and the server logs why at start-up. The rest of the app keeps working. Without `GROQ_API_KEY`, existing suggestions can be read but runs cannot start. The evidence model is `EVIDENCE_GROQ_MODEL` (default `openai/gpt-oss-120b`), separate from `GROQ_MODEL`, because the evidence calls send `reasoning_effort` and use JSON mode.

2. **Apply the database migration.** Open the Supabase SQL editor and run `backend/supabase/migrations/001_evidence_assessment.sql`. Run the pre-check from the comment at the top of that file first: it shows whether `projectId`, `itemId` and `userId` are `uuid` columns, which the migration assumes. The migration creates the evidence tables with row level security and no policies (only the server's service role can reach them), a search function, and a private `evidence-screenshots` storage bucket.

3. **Install the capture browser**, in `backend/` (that is where pages are captured):

   ```bash
   cd backend && npx playwright install chromium
   ```

   A browser you run yourself and reach through `BROWSER_WS_ENDPOINT` must be started with the flags in `LOCKED_DOWN_BROWSER_ARGS` (`backend/src/features/evidence/browser.ts`). They take the network away from the browser itself, so a page cannot reach an internal address through it.

4. Evidence calls use the same bearer token as the rest of the app, issued at login by `POST /api/auth/login`. If the evidence panel reports that you are not signed in (a 401), sign out and in again.

### Known limits

- A **Public pages** run reads public webpage text only: nothing behind a login. Checking behind a login is the separate **App** source, described next.
- Links to PDFs and other files are not followed.
- Page text is the page's `innerText`, which leaves out everything inside shadow roots, open or closed. Only the control lines, from the page snapshot, see into open shadow roots.
- Hidden text is filtered out by a heuristic (display, visibility, size, opacity and similar). It catches the common tricks, not every possible one.
- A close-up of a quote is left out when the quote cannot be boxed truthfully on the page. The full-page screenshot is shown instead.
- DNS rebinding and very large compressed responses are accepted residual risks in this version.
- The evidence routes check the login token themselves and take the user id and role from it, never from the request.
- **Page text is sent to Groq**, with the checklist item wording. Do not point the feature at pages you may not share with it.

---

## Checking inside the app (test accounts)

On the same panel there is a second source, **App (test accounts)**. Here the AI does not read public web pages. It uses a platform's web app, signed in as test accounts that the auditor makes for this purpose (for example a 15-year-old and a 30-year-old). It clicks and types like a person, one checklist item at a time, and takes a screenshot after every step. Then it suggests an answer, with the steps as proof.

**The auditor still decides.** An app run only gives suggestions. Nothing changes an answer or the compliance score until an auditor presses Accept or Override, the same as for page runs. Each app suggestion has a **Replay steps** button. It shows every step in order, with its screenshot and a plain sentence about what was done. It also shows actions that were refused and any setting that was left changed (or put back).

### Set up

1. **Make a secret key.** Add `EVIDENCE_SECRET_KEY` to `backend/.env`. It must be 32 random bytes written in base64. You can make one with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   The server uses this key to lock (encrypt) the test account passwords with AES-256-GCM. Passwords can only be written, never read back: no screen or API shows a saved password again. **If you change or remove the key, the saved passwords can no longer be unlocked.** The accounts still show in the list, but a check that needs one fails with a clear message ("The saved password of Teen 15 can't be read. Enter it again."). Type the passwords in again to fix it. Without the key the panel says app checks are not set up, and the rest of the app keeps working.
2. **Update the database.** In the Supabase SQL editor, first run the pre-check from the comment at the top of `backend/supabase/migrations/002_app_evidence.sql`:

   ```sql
   select to_regclass('public."Evidence_Run"'), to_regclass('public."AI_Suggestion"'), to_regclass('public."Evidence_Page"');
   ```

   All three results must be filled in (not null). That means migration 001 is already applied. Then run `002_app_evidence.sql`. It only adds tables and columns, so running it twice does no harm. The new tables have row level security and no policies, so only the server can use them.
3. **Use the panel.** Choose **App (test accounts)**, save the app address (and any extra login domains, for example a single sign-on page), add the test accounts, tick the items to check, and press **Run app check**. Auditors and the Head Auditor can set up and start a run. Only an Auditor can accept or override.

### Safety rules

The server checks these rules in code before every action. They are not only written in the AI's instructions. When the server is not sure, it refuses. Every refused action is saved as a step, so the auditor can see what the AI tried.

| Rule | What is refused |
|---|---|
| Only our own accounts | Messages, follows, comments, tags, mentions, invites or friend requests aimed at anyone who is not one of the project's test accounts, or with no clear target. |
| Nothing public | Post, Publish, Share, Go live and similar buttons, unless the audience was first set to private (or test accounts only) and the page confirms it. |
| Nothing destructive | Deleting or deactivating an account, changing a password, email or phone number, payments and purchases, signing out other sessions. |
| Stay on the platform | Any address outside the app's host, its subdomains and the listed login domains. Private or local addresses are allowed only through `EVIDENCE_ALLOWED_PRIVATE_HOSTS` (for a demo or test app). Pages may still load files (scripts, styles, images) from other public hosts, but the AI can only move between pages of the app and its login domains. |
| Stop on blocks | A captcha, 2-factor prompt, bot check or "suspicious activity" page ends that check and is reported as a page that could not be read. The system never tries to get past it. |

Settings the AI changes are put back at the end of each check where possible. This covers switches, checkboxes, radio buttons, drop-down lists, toggle buttons that show as pressed or not, and options in a custom drop-down or menu. Anything that could not be put back is shown on the run summary and in the replay, and later checks are told about it. If a test account fails to sign in twice, it is marked unusable for the rest of the run, and the run goes on.

**These rules are a safety net, not a guarantee.** The server decides by reading the words and links on the page, so it can be fooled. Please use dedicated test accounts only, never real people's accounts, and look at the replay before trusting a result.

What the rules cannot catch:

- **A stranger shown only by display name.** The server recognises a person by their `@handle`. If the page shows a stranger only as a name (or a bare name without `@`), a message to them may not be refused.
- **Names stuck to handles.** A display name and a handle written with no space ("Jamie Smith@stranger") are not read as a mention.
- **A public chat box that shows only our test handle.** If the page around a "Send" button shows only our own test handle, a public message can look like a private one.
- **Short words in addresses.** Pages with `t` or `chat` in the address can be mistaken for conversations. The part of the address after `?` or `#` is ignored.
- **English only.** The word lists for "public" and "destructive" are English only.
- **Custom drop-downs that close.** If a custom drop-down closes after a choice, its new value cannot be read. The change is listed as unknown, and it is put back only if the old option can be seen when the page is opened again (the drop-down is not opened first). Otherwise it is shown as not put back.
- **Controls that do not say their state.** A button or option that does not say whether it is on (pressed, selected or checked) is not seen as a setting, so a change made with it is not recorded.

What the rules refuse because they cannot be sure (safe, but these checks are lost):

- A message typed into a single-line text box cannot be sent. Apps that use a multi-line box work.
- A setting on a form that also has a text box (a profile form with a bio, for example) cannot be changed or put back without a private audience.
- "Add a comment" boxes are refused. A "Tag people" button next to a post box blocks typing. Clearing a people field is refused.
- A button made from an image input is not seen as a button.
- Password fields inside iframes or shadow roots are not blanked in screenshots, and such login forms cannot be used.

### What is sent to Groq

Only text goes to Groq: the visible text of each page, a short list of its controls, the checklist item wording, and the plain sentences of earlier steps. **Passwords are never sent, and screenshots are never sent.** The browser types the password itself, and the password box is blanked before every screenshot. A login name is hidden the same way, unless it is one of the account's own handles or shorter than 4 characters. Screenshots are kept only as proof for people. If the AI is not available, the item is left "not checked" and nothing is guessed.

### Limits

All set in `backend/src/features/evidence/config.ts`:

| Limit | Value |
|---|---|
| Steps per check (one item) | 15 |
| AI tokens per app run (step and judging calls together) | 200 000 |
| Items per app run | 10 |
| Time for a whole app run | 30 minutes |
| Test accounts per project | 6 |
| Login domains per project | 5 |

If the token limit is reached, or Groq's daily limit is hit during a run, the run ends as **partial**. Items already checked keep their suggestions, the others are listed as not checked, and any setting that was changed is still put back.

### Before real use

Using a real platform's web app with test accounts usually needs that platform's agreement, because its terms often forbid automated use. Get permission first. The system does not check this for you, and `robots.txt` does not apply to app runs. A person should also watch the replay before accepting any suggestion.

The server's browser is locked down so that a page cannot reach internal addresses through it. One effect is that features which use WebSockets, such as live chat and live notifications, do not work in it. A check that needs those features cannot be done.

## Code repository evidence

The panel has a third source, **Code repository**. Here the AI reads the source code of a platform's **public GitHub repository** and looks for code that answers a checklist item (for example, code that makes new accounts of under-18 users private).

**What is read.** The auditor saves a repository address such as `https://github.com/owner/name` (a branch is optional). The system downloads a copy of the code and keeps it in memory only. It looks for the parts of the code that match the item and sends those short passages to the AI as text.

**Public GitHub only.** Private repositories and other websites do not work. No GitHub login or token is used.

**Nothing from the repository is run.** The code is only read as text. It is never installed, started or saved to disk. The AI is told that the text in the code is data and not instructions, so a comment in the code cannot tell it what to answer.

**The auditor still decides.** A code run only gives suggestions, the same as the other sources. No answer or score changes until an auditor presses Accept or Override. Each code suggestion has a **Code found** button that shows the exact lines the AI looked at, with a link to open them on GitHub. The card also says which commit was read, for example "Based on the code at commit abc1234, not on the live app." So the suggestion reflects the code, not the running app. They can differ.

**Comments-only answers are flagged.** If a Yes, No or Partially answer rests only on comments, documentation or test files, the card shows a **Comments only** flag, because that is weak proof of what the app really does.

### Limits

All set in `backend/src/features/evidence/config.ts`:

| Limit | Value |
|---|---|
| Download size | 50 MB |
| Files kept | 5 000 |
| Size of one file | 300 KB |
| Lines kept in total | 2 000 000 |
| Items per run | 10 |

Folders such as `node_modules`, `dist` and `.git`, lock files, minified files and binary files are skipped. On Groq's free plan only about 3 items fit in one run before the daily limit is hit. The run then ends as **partial**, and the items already checked keep their suggestions.

### Setup

This feature needs database migration `003_repo_evidence.sql`. Run it **after** `002`, in the Supabase SQL editor.

### Before real use of code evidence

Using a platform's code for an audit usually needs that platform's agreement. Get permission first. The system does not check this for you.

---

## Tests

```bash
npm test --prefix backend            # unit and integration tests
npm test --prefix frontend           # component and hook tests (Vitest, jsdom)
npm run test:e2e --prefix frontend   # browser end-to-end tests (Playwright)
```

The end-to-end tests start Vite on port 5199 and stub every `/api` call and every Supabase call in the browser, so they need no database, keys or network. Install the browser once with `npx playwright install chromium` in `frontend/` (or reuse the one already installed for the backend). They cover running an assessment, accepting and overriding, the Head Auditor's provenance labels, the flagged filter, a 503 from the evidence API, and the app flow (adding the app and two test accounts, picking items, running, replaying the steps, accepting one suggestion, the password never showing on the page, and the app endpoints answering 503).

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
