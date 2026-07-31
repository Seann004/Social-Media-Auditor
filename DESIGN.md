# SafetyAudit — Design System (developer guide)

How to build UI that is on-brand for **SafetyAudit**. The brand is a calm, institutional
compliance tool: **slate neutrals** with **one blue accent**, flat surfaces, generous
whitespace, real data everywhere (no round-number fake scores). It is a **single light
theme** — there is no dark mode and no theme toggle anywhere in the app.

This is the human guide. The machine truth for colour is
[`frontend/src/styles/colors.css`](./frontend/src/styles/colors.css) (CSS custom
properties), mirrored into Tailwind utilities by
[`frontend/tailwind.config.js`](./frontend/tailwind.config.js). **If you add or change a
token, change it in both files — `colors.css` defines the value, `tailwind.config.js`
exposes it as a utility.**

---

## 1. How the theme is wired

This is a **Vite + React + Tailwind v3** app — not Next.js, not Tailwind v4 CSS-first
theming. There is no `@theme` block and no `next/font`.

- **`frontend/src/styles/colors.css`** — a single `:root { }` block of `--color-*`
  custom properties. Its own header comment says *"never use raw hex codes"* — in
  practice that's aspirational for hardcoded literals, not a rule against Tailwind's own
  palette classes; see the note below and §2.
- **`frontend/tailwind.config.js`** — `theme.extend.colors` maps each Tailwind utility
  (`bg-primary`, `text-heading`, …) to `var(--color-*)`. `theme.extend.fontFamily` and
  `theme.extend.fontSize` are also declared here (see §3).
- No `.dark` class, no `[data-theme]`, no OS-preference detection. One palette, always
  applied.

**Tokens are named aliases for specific Tailwind palette stops, not a parallel colour
system.** `--color-primary` is *exactly* Tailwind `blue-600` (`#2563eb`), `--color-success`
is exactly `emerald-600`, `--color-danger` is exactly `red-600`, `--color-warning` is
exactly `amber-600` — check `colors.css` against Tailwind's default palette and they
match hex-for-hex. So a component reaching for `bg-emerald-50` or `text-rose-700` isn't
introducing a different colour system than one reaching for `bg-success`/`text-danger` —
it's the *same* hue family at a different stop of the ramp that `colors.css` doesn't
happen to name. Both are correct; see §2 for when to use which.

### Utility cheat-sheet

| Need | Use |
|------|-----|
| App background / card / input | `bg-page-bg` · `bg-card` · `bg-input-bg` |
| Text heading / body / secondary / muted | `text-heading` · `text-body` · `text-secondary` · `text-muted` |
| Primary action | `bg-primary` `hover:bg-primary-hover` · soft fill `bg-primary-light` |
| Compliant / non-compliant / flagged | `success` · `danger` · `warning` token families |
| Borders | `border-border` (default) · `border-border-light` (hairline) · `border-border-focus` |
| Sidebar surfaces | `bg-sidebar-bg` `text-sidebar-text` `bg-sidebar-item-active` |
| Numbers (scores, counts, percentages) | add **`tabular-nums`** |
| Radius | `rounded-lg` (controls) · `rounded-xl` (cards) · `rounded-2xl` (login card / modals) · `rounded-full` (avatars, pills) |
| Elevation | `shadow-sm` (resting card) · `shadow-lg`/`shadow-2xl` (modals, floating only) |

---

## 2. Colour

### Brand — blue (the one accent)
| Token | Hex | Use |
|-------|-----|-----|
| `primary` | `#2563eb` | primary buttons, active nav, sidebar background, login background |
| `primary-hover` | `#1d4ed8` | pressed / hover |
| `primary-light` | `#eff6ff` | soft fills, highlighted rows |
| `primary-border` | `#bfdbfe` | focus rings, subtle outlines |
| `primary-text` | `#1e40af` | text on light blue fills |
| `primary-muted` | `#93c5fd` | disabled/quiet accents |

Blue carries three jobs at once here — brand, primary action, *and* the sidebar/login
surface — because this is an internal tool, not a marketing site. That's intentional; don't
split it into a separate "sidebar colour."

### Semantic
| Token | Hex family | Meaning |
|-------|------------|---------|
| `success` | `#059669` (+ hover/light/border/text) | compliant, approved |
| `danger` | `#dc2626` (+ hover/light/border/text) | non-compliant, rejected, destructive actions |
| `warning` | `#d97706` (+ hover/light/border/text) | flagged, pending review |

### Neutral surfaces
| Role | Hex | Utility |
|------|-----|---------|
| Page background | `#f8fafc` | `bg-page-bg` |
| Card | `#ffffff` | `bg-card` |
| Card hover | `#f8fafc` | `bg-card-hover` |
| Input background | `#f8fafc` | `bg-input-bg` |
| Border (default) | `#e2e8f0` | `border-border` |
| Border (hairline) | `#f1f5f9` | `border-border-light` |
| Border (focus) | `#93c5fd` | `border-border-focus` |

### Text
`heading #0f172a` · `body #1e293b` · `secondary #64748b` · `muted #94a3b8` ·
`placeholder #cbd5e1` · `on-dark #ffffff` (text on the blue sidebar/login surface).

### Sidebar (blue surface — same family as login and primary buttons)
`sidebar-bg #2563eb` · `sidebar-text rgba(255,255,255,.75)` ·
`sidebar-text-hover #ffffff` · `sidebar-item-hover rgba(255,255,255,.15)` ·
`sidebar-item-active rgba(255,255,255,.22)` · `sidebar-border rgba(255,255,255,.18)` ·
`sidebar-muted rgba(255,255,255,.50)`.

### Role identity
`head-auditor #8b5cf6` (violet) · `auditor #10b981` (emerald) · `admin #2563eb` (blue —
same as brand primary, since admin is the platform-owner role).

### Severity
`critical #dc2626` · `major #d97706` · `minor #64748b` — same scale as the danger/warning
semantic tokens, reused rather than duplicated.

### Platforms
`tiktok #0f172a` · `instagram #ec4899` · `facebook #2563eb` · `snapchat #facc15` ·
`youtube #dc2626` · `discord #6366f1` · `bereal #374151` · `twitter #0f172a`.
Rendered as a 2-letter uppercase initial in a colour-filled `rounded-lg` square (never a
platform logo asset — see §6 for the same convention on the app's own logo).

### Status
Audit status: `draft #94a3b8` · `progress #3b82f6` · `review #f59e0b` · `complete #10b981`.
Submission status: `pending #d97706` · `approved #059669` · `rejected #dc2626`.

### Named tokens vs raw Tailwind classes — when each is used

These are **not** two competing colour systems — every named token is a literal alias
for one specific stop of the same Tailwind ramp (see §1). Which one a component reaches
for depends on what it's doing, and both are correct:

- **Named tokens** (`bg-primary`, `text-heading`, `border-border`, `bg-success`, …) —
  used for app-shell chrome: the sidebar, primary/semantic buttons, page and card
  backgrounds, the default text hierarchy, and default borders. This is where
  `colors.css` is the actual source of truth someone would tweak to reskin the app.
- **Raw Tailwind classes in the same hue families** (`slate`, `blue`, `emerald`,
  `rose`/`red`, `amber`, `violet`, `indigo`) — used everywhere else: badges, chips,
  status pills, hover/tint backgrounds, category labels. `StatusBadge` and
  `SeverityBadge` (`src/features/audits/components/`) are typical examples —
  `bg-emerald-50 text-emerald-700 ring-emerald-200`, `bg-rose-50 text-rose-700
  ring-rose-200`, `bg-amber-50 text-amber-700 ring-amber-200`, `bg-indigo-50
  text-indigo-700`, `bg-slate-100 text-slate-500/600` — reaching for a `-50`/`-100`/`-200`
  tint or a `-700` text shade that `colors.css` doesn't name a token for. **This is the
  norm across feature UI, not an edge case** — most of the app's colour usage looks like
  this rather than `bg-success`/`text-danger`.
- **Raw hex literals** (`'#10b981'`, `stroke="#e2e8f0"`, …) — the one place `colors.css`'s
  "never use raw hex" comment is genuinely a hard rule to break only for a real technical
  reason: SVG `stroke`/`fill` attributes and inline chart-data colours (`ScoreRing`,
  `DashboardPage`'s donut/bar charts) can't consume a Tailwind class at all. Every
  instance of this in the codebase hardcodes a value that's *already* one of the tokens
  above (`#e2e8f0` = border, `#2563eb` = primary, `#059669` = success, …) — it's the same
  palette, just written as a literal because the rendering target requires one.

**The actual rule:** stay within the palette families above (slate neutrals; blue
primary; emerald/rose/amber semantic; violet/emerald role colours) and prefer the named
token when one exists for what you're doing. Never introduce a hue outside these
families, and never hardcode a hex literal *unless* the rendering target genuinely can't
take a class (SVG attributes, inline chart config).

---

## 3. Typography

**Inter**, loaded via a Google Fonts `<link>` in `index.html`. System sans-serif is
fallback only. Weights loaded: 400 / 500 / 600 / 700 / 800. `font-sans` and `font-mono`
both resolve to Inter (`tailwind.config.js`) — there is no separate monospace typeface.
Don't reintroduce a second family for "mono-style" UI (version tags, item codes, clause
badges) — those stay Inter, just styled smaller/uppercase/tracked.

For aligned figures (scores, percentages, item counts), apply `tabular-nums` explicitly —
Inter supports tabular figures via OpenType, but unlike a true monospace font it only
activates when asked.

Size scale (`tailwind.config.js` → `theme.extend.fontSize`, one step up from Tailwind's
defaults so the whole UI reads larger — there are no semantic tokens like `text-h1`;
components use this raw scale directly):

| Class | Size | Line height |
|-------|------|-------------|
| `text-xs` | 13px | 20px |
| `text-sm` | 15px | 24px |
| `text-base` | 17px | 28px |
| `text-lg` | 19px | 30px |
| `text-xl` | 21px | 32px |
| `text-2xl` | 25px | 34px |
| `text-3xl` | 31px | 38px |

---

## 4. Radius, spacing, elevation

- **Radius scales with role, not a formal token** (no `rounded-card`/`rounded-input`
  alias exists — these are the conventions in practice, keep them consistent):
  buttons/inputs/small badges → `rounded-lg` · cards/panels/dropdowns → `rounded-xl` ·
  login card, register card, and confirmation modals (Delete, Sign Out, Print) →
  `rounded-2xl` · avatars, pills, circular icon buttons → `rounded-full`.
- **Spacing:** container is `max-w-[1400px] mx-auto px-6 md:px-10`; section padding is
  `py-8 md:py-10`; body text max width is `max-w-[65ch]`. Card padding is generally `p-5`
  to `p-6`. Feature data lists use `divide-y` rows, not equal-width card grids (see §9).
- **Elevation is mostly flat:** resting cards use `shadow-sm` at most, relying on
  `border-border`/`border-border-light` hairlines for separation over shadows. Reserve
  `shadow-lg`/`shadow-2xl` for things that actually float — the login/register card, and
  modals (Delete Project, Sign Out, Print confirmation). A custom softer shadow —
  `0 1px 8px -2px oklch(0.3 0.01 250 / 0.06)`, tinted toward slate, never pure black — is
  used where Tailwind's default shadow reads too harsh.

---

## 5. Theming

**Single light theme. No dark mode, no toggle, no `prefers-color-scheme` handling.**
Every surface in the app — including the sidebar and login page — always renders the same
palette from §2. If a future request asks for dark mode, that's a new feature, not a
"flip the tokens" change — `colors.css` has no dark-variant values to flip to.

---

## 6. Logo

There is no logo image asset — no `public/logo/` folder, no raster wordmark. The
"logo" is built from a Phosphor `ShieldCheck` icon in a `rounded-xl` blue
(`bg-primary`) square, next to the wordmark text "SafetyAudit" (`font-bold`) with a
small uppercase tagline underneath ("Compliance Audit Platform", `text-muted
tracking-[0.12em]`). This pattern repeats identically in the login card header and the
sidebar header — **don't fork it into two different logo treatments.** The only actual
image asset is `public/favicon.svg`.

---

## 7. App shell

Built in [`src/layouts/Layout.tsx`](./frontend/src/layouts/Layout.tsx) +
[`src/layouts/Sidebar.tsx`](./frontend/src/layouts/Sidebar.tsx): a fixed **blue sidebar**
(`bg-sidebar-bg`, `w-72`) + light main content area. Desktop-first — this is an internal
audit tool, not a consumer app.

```
┌───────────┬──────────────────────────────────────────────────────────┐
│  SIDEBAR  │                                                            │
│  (always  │   MAIN CONTENT (light bg-page-bg, scrolls)                 │
│  blue —   │   max-w-[1400px] mx-auto px-6 md:px-10, py-8 md:py-10       │
│  no theme │                                                            │
│  to       │   Dashboard: stats strip (divide-x) → asymmetric 2/3 + 1/3  │
│  follow)  │   grid. Projects/Reports: divide-y row lists, not card      │
│           │   grids. Audit: fixed left category nav (208px) +          │
│ ┌───────┐ │   scrollable checklist content.                            │
│ │ Logo  │ │                                                            │
│ ├───────┤ │                                                            │
│ │ Dash  │ │  active = bg-sidebar-item-active, idle = sidebar-text,      │
│ │ Audits│ │  hover = sidebar-item-hover (role-gated, see §8)            │
│ │ Guide-│ │                                                            │
│ │ lines │ │                                                            │
│ │ Report│ │                                                            │
│ ├───────┤ │                                                            │
│ │ user  │ │  ← click opens a Sign Out confirm modal, never signs        │
│ │profile│ │    out on the first click                                  │
│ └───────┘ │                                                            │
└───────────┴──────────────────────────────────────────────────────────┘
```

**Rules (as built):**
- **Sidebar** — `w-72` desktop, off-canvas drawer on mobile (`-translate-x-full` → `0`,
  `transition-transform duration-300 ease-in-out`, `bg-black/50` backdrop, closes on
  backdrop click). Always the blue surface — it does not lighten or theme-follow, because
  there is no theme to follow.
  - **Motion note:** the drawer transition doesn't currently gate behind
    `prefers-reduced-motion` — if you touch this component, consider adding
    `motion-reduce:transition-none` to match the reduced-motion discipline used elsewhere
    (framer-motion springs, §11).
- **Nav items** — role-filtered list (see §8), `rounded-lg` (via the nav item's own
  padding/hover classes), active state = `bg-sidebar-item-active` + `text-sidebar-text-hover`.
- **User profile / sign out** — bottom of the sidebar: avatar circle (role colour +
  initials) + name + role. Clicking it opens a confirmation modal (`rounded-2xl`,
  `shadow-2xl`) rather than signing out immediately — this was a deliberate fix; don't
  regress it back to an instant sign-out on click.
- **Main content** — no topbar. Each page renders its own heading + actions row at the
  top of the content area instead of a shared sticky bar.

---

## 8. Information architecture — role-gated routes

There are three roles — `admin`, `head_auditor`, `auditor` — and routing is gated in two
layers: `RoleRoute` (`src/layouts/RoleRoute.tsx`) hides/redirects at the frontend, and
every backend route re-checks the same role server-side (`requireRole` middleware) plus,
for project-scoped routes, a project-membership check (`requireProjectAccess` /
`requireProjectOwner`) — **the nav is discoverability, the server is the actual gate.**

| Route | Page | Who |
|---|---|---|
| `/dashboard` | `DashboardPage` | everyone (content differs — admin sees guideline management inline, not a KPI dashboard) |
| `/projects`, `/projects/:id`, `/reports` | `ProjectsPage`, `AuditPage`, `ReportsPage` | `head_auditor`, `auditor` |
| `/projects/new`, `/guidelines` | `CreateProjectPage`, `GuidelinesPage` | `head_auditor` only |
| `/generator` | `GeneratorPage` | `admin` only |

Within a project, access is further scoped to **that project's** head auditor + assigned
members — a head auditor who owns Project A cannot delete or review-approve Project B
just because they hold the `head_auditor` role globally. Two levels: role = *what kind of
action*, project membership = *which project(s)*.

**Sidebar nav differs by role** (`Sidebar.tsx`): auditor sees Dashboard/Audits/Reports;
head_auditor adds Guidelines; admin sees only Dashboard/Generator (admin doesn't audit
projects at all).

---

## 9. Page patterns

- **Dashboard** — stats strip with `divide-x` separators inside one white container,
  then an asymmetric 2/3 + 1/3 grid (recent audits + team panel / upcoming deadlines).
  Admin gets a completely different dashboard (guideline management), not a variant of
  the same layout — see `DashboardPage.tsx`'s `isAdmin` branch.
- **Projects / Reports lists** — `divide-y` rows inside one white container, **not**
  three-equal-card grids. Each row: platform initial square, name + guideline chips,
  compliance `ScoreBar`, progress count, auditor avatars, status badge.
- **Audit page** — fixed left category nav (`208px`) + scrollable right content. Once a
  project is submitted for review (`pending_review`/`approved`), answer controls render
  visibly disabled (`opacity-50 cursor-not-allowed`) rather than just silently rejecting
  clicks — always pair a disabled affordance with the interaction it blocks.
- **Login/Register** — card-first: logo lives inside the card (not floating above),
  topped by a 3px blue accent strip (`bg-primary`). Background is the blue `login-bg`
  surface + a subtle 52px grid at 3% opacity. Both pages share this exact pattern; don't
  let register drift into its own layout.
- **Confirmation modals** — Delete Project, Sign Out, Print report all follow one shape:
  centered `rounded-2xl shadow-2xl` card over a `bg-slate-900/40 backdrop-blur-sm`
  scrim, icon in a tinted circle, one-line question, Cancel (`bg-slate-100`) +
  confirm (`bg-{danger|primary}-600`) side by side. Reuse this shape for any new
  destructive/consequential action rather than inventing a new modal style.

---

## 10. Component inventory

Custom, in `src/layouts/` and `src/features/*/components/`:

- **`Layout`** — sidebar + main content shell (§7).
- **`Sidebar`** — nav + user profile + Sign Out confirmation modal (§7).
- **`ProtectedRoute`** — redirects to `/` if not authenticated.
- **`RoleRoute`** — redirects to `/dashboard` if the current user's role isn't in
  `allowedRoles` (§8).
- **`StatusBadge`** — checklist-item and audit-status pill; fixed-pair colours (§2).
- **`SeverityBadge`** — critical/major/minor pill; fixed-pair colours (§2).
- **`AuditorAvatar`** — role-coloured circle with initials, `xs`/`sm`/`md` sizes,
  optional name.
- **`ScoreRing`** — animated SVG ring (`stroke-dashoffset` transition,
  `1.1s cubic-bezier(0.16,1,0.3,1)`), colour thresholds ≥80% emerald / ≥60% amber / <60%
  rose. `aria-label` carries the percentage for screen readers.
- **`ScoreBar`** (inline, `ProjectsPage.tsx`) — horizontal version of the same
  threshold logic, `scaleX()` transition.

Reuse these before building a new badge/avatar/score visualisation — the colour
thresholds and animation timing are meant to be consistent everywhere a score appears.

---

## 11. Motion

Library: **framer-motion v11**.

- Spring (standard): `{ type: 'spring', stiffness: 100, damping: 20 }`
- Spring (snappy / tap): `{ type: 'spring', stiffness: 400, damping: 30 }`
- Spring (expand/collapse): `{ type: 'spring', stiffness: 200, damping: 28 }`
- CSS easing fallback: `cubic-bezier(0.16, 1, 0.3, 1)`
- Score bars: `transform: scaleX()` via CSS transition, `0.9s cubic-bezier(0.16,1,0.3,1)`
- Score ring: SVG `stroke-dashoffset` via CSS transition, `1.1s cubic-bezier(0.16,1,0.3,1)`
- Page stagger: `staggerChildren: 0.07`, `delayChildren: 0.05`
- Sidebar nav stagger: `staggerChildren: 0.06`, `delayChildren: 0.1`, slide from `x: -10`
- Modals (Delete/Sign Out/Print confirm): backdrop fade + card
  `scale: 0.95 → 1, y: 10 → 0`, `{ type: 'spring', duration: 0.3 }`, via
  `AnimatePresence`.
- **Banned:** linear easing (except shimmer), bounce/elastic, animating
  width/height/top/left directly (animate `scaleX`/`transform` instead).

---

## 12. Project-specific business rules

- **Compliance score:** `percentage = compliant / applicable * 100` — `not_applicable`
  items are excluded from the denominator; `partially` counts as 0.5 toward the
  numerator.
- **Audit progress:** `progress = answered / total * 100` — every response state except
  `not_started`/`needs_review` counts as answered; this is a *different* formula from
  compliance (all guidelines' items, not just applicable ones).
- **A project can have multiple guidelines attached.** Approval requires full coverage
  across *all* of them, not just whichever one happened to get audited first — the
  backend re-checks this at approve time (`reviewSubmission`), independent of whatever
  the UI shows.
- **Score colour thresholds:** ≥80% emerald, ≥60% amber, <60% rose — the one numeric
  threshold set in the whole app; reuse it (`ScoreRing`, `ScoreBar`) rather than
  inventing another cutoff elsewhere.
- **Platform initials:** 2-char uppercase abbreviation in a colour-filled `rounded-lg`
  square — no logo assets, ever (same convention as the app's own logo, §6).
- **No round-number fake scores** — every percentage shown is computed from real
  response data, never a placeholder.

---

## 13. Principles & checklist

1. **Stay in the palette families, prefer the token when one exists** — named tokens
   (`bg-primary`, `text-heading`, …) for app-shell chrome; raw Tailwind classes in the
   *same* hue families (slate/blue/emerald/rose/amber/violet) are the norm for badges,
   tints, and everything else — that's not a workaround, see §2. Never introduce a hue
   outside these families, and never hardcode a hex literal unless the target genuinely
   can't take a class (SVG attributes, inline chart config).
2. **One accent, used with intent** — blue is brand, primary action, *and* the
   sidebar/login surface. Don't add a second accent colour; borrow success/danger/warning
   for anything status-related.
3. **Flat first** — hairlines and whitespace over shadows; `shadow-lg`/`2xl` only for
   things that actually float (modals, the login card).
4. **Single theme, no exceptions** — never gate a style behind `dark:` or a theme
   toggle; there isn't one.
5. **Tabular numerals on every figure** — scores, item counts, percentages all get
   `tabular-nums`.
6. **Role gates are enforced server-side, not just hidden in the sidebar** — a new
   role-restricted feature needs both a `RoleRoute` (UX) and a backend `requireRole` /
   `requireProjectAccess` check (the actual gate). Never ship the restriction as a
   frontend-only `if`.
7. **Pair a disabled control with a reason** — don't silently no-op a click (locked
   audit answers, locked evidence upload); disable visibly and, where practical, say why.
8. **Confirm before anything irreversible** — deleting a project, signing out, and
   triggering a native browser dialog (print) all go through the shared confirmation
   modal shape (§9), not an instant action on click.
9. **Reuse the primitives** (§10) before building a new badge, avatar, or score
   visualisation — the colour thresholds and animation timing are shared intentionally.
10. **No round-number fake data** — every score, count, and percentage in the UI is
    computed from real response rows.
