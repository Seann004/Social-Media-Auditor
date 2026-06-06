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
└── backend/                    ← Express REST API
    └── src/
        ├── server.ts           ← All API routes
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

---

## Useful Commands

```bash
# Type-check frontend
cd frontend && npx tsc --noEmit

# Type-check backend
cd backend && npx tsc --noEmit

# Build frontend for production
cd frontend && npm run build
```
