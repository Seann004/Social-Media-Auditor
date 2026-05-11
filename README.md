# SafetyAudit — Child Safety Compliance Platform

A web application for structured compliance audits of social media platforms against child safety frameworks (ICO Children's Code, COPPA, CSAM Detection Standards, OECD Guidelines).

---

## Getting Started

### Prerequisites

- **Node.js** v18 or higher — check with `node --version`
- **npm** v9 or higher — check with `npm --version`

### 1. Clone the repository

```bash
git clone <repo-url>
cd Social-Media-Auditor
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

The app will be available at **http://localhost:5173**

---

## Logging In

The app uses mock authentication. Use any of the accounts below:

| Name | Email | Password | Role |
|---|---|---|---|
| Jackie Chan | `jackie@safetyaudit.org` | `audit2026` | Head Auditor |
| John Lee | `john@safetyaudit.org` | `audit2026` | Auditor |
| Ahmad bin Ali | `ahmad@safetyaudit.org` | `audit2026` | Auditor |
| Sanji Nambiar | `sanji@safetyaudit.org` | `audit2026` | Auditor |

> You can also click the quick-access tiles on the login page to auto-fill credentials.

---

## Pages

| Route | Page | Description |
|---|---|---|
| `/` | Login | Authentication page |
| `/dashboard` | Dashboard | Overview — KPIs, recent audits, team, deadlines |
| `/projects` | Audit Projects | List of all audit projects with filters |
| `/projects/new` | New Audit | Create a new audit project (head auditor only) |
| `/projects/:id` | Audit Detail | Checklist interface with Pass / Fail / N/A controls |
| `/guidelines` | Guidelines | Browse all compliance frameworks and their items |
| `/reports` | Reports | Compliance score breakdown by project, guideline, and severity |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS v3 |
| Animation | Framer Motion v11 |
| State | Zustand |
| Routing | React Router v6 |
| Icons | Phosphor Icons |

---

## Project Structure

```
src/
├── components/
│   ├── Layout.tsx          # Sidebar + main content shell
│   ├── Sidebar.tsx         # Navigation sidebar
│   ├── ProtectedRoute.tsx  # Auth guard
│   └── ui/
│       ├── AuditorAvatar.tsx
│       ├── ScoreRing.tsx
│       ├── SeverityBadge.tsx
│       └── StatusBadge.tsx
├── data/
│   └── mockData.ts         # Users, guidelines, checklist items, projects, responses
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── ProjectsPage.tsx
│   ├── NewAuditPage.tsx
│   ├── AuditPage.tsx
│   ├── GuidelinesPage.tsx
│   └── ReportsPage.tsx
├── store/
│   └── useStore.ts         # Zustand store — all app state + actions
└── types/
    └── index.ts            # TypeScript interfaces
```

---

## Other Commands

```bash
# Type check without building
npx tsc --noEmit

# Build for production
npm run build

# Preview the production build locally
npm run preview
```

---

## Notes

- All data is **in-memory only** — refreshing the page resets audit responses to the pre-loaded mock data. There is no backend or database.
- To add new guidelines or checklist items, edit `src/data/mockData.ts`.
- To change the team members, update the `USERS` array and `MOCK_CREDENTIALS` in `src/data/mockData.ts` and `src/store/useStore.ts`.
- Design tokens and aesthetic decisions are documented in [DESIGN.md](./DESIGN.md).
