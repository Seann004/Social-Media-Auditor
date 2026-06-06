# SafetyAudit — Child Safety Compliance Platform

A full-stack web application for structured compliance audits of social media platforms against child safety regulatory frameworks (e.g. eSafety AU, MY PDPA, ONSA Child Protection Code).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Vite |
| Styling | Tailwind CSS v3, Framer Motion |
| State | Zustand (persisted auth only) |
| Routing | React Router v6 |
| Icons | Phosphor Icons |
| Backend | Node.js + Express (TypeScript) |
| Database | Supabase (PostgreSQL) |
| AI Generator | Groq API — Llama 3.3 70B |

---

## Project Structure

```
Social-Media-Auditor/
├── frontend/                  ← Vite + React app
│   ├── src/
│   │   ├── features/
│   │   │   ├── audits/        ← AuditPage (checklist interface)
│   │   │   ├── auth/          ← Login, Register
│   │   │   ├── dashboard/     ← Dashboard overview
│   │   │   ├── generator/     ← AI guideline generator
│   │   │   ├── guidelines/    ← Browse compliance frameworks
│   │   │   ├── projects/      ← Project list + new audit
│   │   │   └── reports/       ← Compliance reports
│   │   ├── hooks/
│   │   │   └── useProjectData.ts
│   │   ├── layouts/           ← Layout, Sidebar, ProtectedRoute
│   │   ├── lib/
│   │   │   ├── db.ts          ← REST API client
│   │   │   └── supabase.ts    ← Auth RPC client
│   │   ├── store/
│   │   │   └── useStore.ts    ← Zustand global store
│   │   └── types/
│   │       └── index.ts
│   └── .env                   ← Frontend env vars
└── backend/                   ← Express REST API
    ├── src/
    │   ├── server.ts          ← All API routes
    │   ├── services/
    │   │   └── dbService.ts   ← Supabase queries
    │   └── config/
    │       └── supabase.ts
    └── .env                   ← Backend env vars
```

---

## Getting Started

### Prerequisites

- **Node.js** v18+ — `node --version`
- **npm** v9+ — `npm --version`

---

### 1. Clone the repository

```bash
git clone <repo-url>
cd Social-Media-Auditor
```

---

### 2. Set up environment variables

**`backend/.env`**
```
PORT=3000
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
GROQ_API_KEY=your_groq_api_key        # optional — only needed for AI generator
GROQ_MODEL=llama-3.3-70b-versatile    # optional
```

**`frontend/.env`**
```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_API_URL=http://localhost:3000/api
```

---

### 3. Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

---

### 4. Start both servers

Open two terminals:

**Terminal 1 — Backend**
```bash
cd backend
npm run dev
```
Runs on **http://localhost:3000**

**Terminal 2 — Frontend**
```bash
cd frontend
npm run dev
```
Runs on **http://localhost:5173**

---

## Pages

| Route | Page | Access |
|---|---|---|
| `/` | Login | Public |
| `/register` | Register | Public |
| `/dashboard` | Dashboard | All roles |
| `/projects` | Audit Projects | All roles |
| `/projects/new` | New Audit | Head Auditor |
| `/projects/:id` | Audit Detail | All roles |
| `/guidelines` | Guidelines | Admin, Head Auditor |
| `/generator` | AI Generator | Admin |
| `/reports` | Reports | All roles |

---

## Roles

| Role | Permissions |
|---|---|
| **Admin** | Manage guidelines, run AI generator, no audit access |
| **Head Auditor** | Create/manage audit projects, assign auditors, manage guidelines per project, review submissions |
| **Auditor** | Answer checklist items (Yes / No / Partially / N/A / Flag), add findings and notes, submit for review |

---

## Audit Workflow

1. Head Auditor creates a project, selects guidelines, assigns auditors
2. Auditors open the project and work through checklist items per guideline tab
3. Each item has: **Yes / No / Partially / N/A** response buttons + a **Flag** for items needing review
4. Auditors record **Findings** (what was observed) and optional **Notes**
5. Each item has a **Help** button (audit guidance) and **Traceability** tab (verbatim clause text + clause reference)
6. Once all items are answered, auditor submits for review
7. Head Auditor approves or rejects with remarks

---

## Data Model (Key Tables)

| Table | Purpose |
|---|---|
| `User` | Users with roles |
| `Audit_Project` | Audit projects |
| `Guideline` | Compliance frameworks |
| `Checklist` | Links project ↔ guideline |
| `Checklist_Item` | Individual audit items (itemCode, itemName, helpText, verbatimClauseText, answerOptions) |
| `Audit_Result` | Auditor responses (Yes/No/Partially/N/A/Flag) + findings + notes |
| `Compliance_Score` | Calculated scores per guideline per project |
| `Project_Member` | Project ↔ user membership |
| `Project_Guideline` | Project ↔ guideline assignment |

---

## Useful Commands

```bash
# Type check (frontend)
cd frontend && npx tsc --noEmit

# Type check (backend)
cd backend && npx tsc --noEmit

# Build frontend for production
cd frontend && npm run build
```
