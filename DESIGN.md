# Design

> Auto-generated and maintained by frontend-god-mode.
> Source of truth for typography, color, motion, layout, and component tokens.
> Read this BEFORE touching the UI in any subsequent session.

## Aesthetic direction

Institutional-precision SaaS — compliance-grade authority with editorial clarity. Slate neutrals (cool blue undertone = trustworthy), desaturated electric blue accent, Geist typography, divide-y data rows instead of card grids. The product should feel like a regulatory audit tool built by people who care about design — serious without being sterile.

## Dials

- DESIGN_VARIANCE: 8 / 10
- MOTION_INTENSITY: 6 / 10
- VISUAL_DENSITY: 4 / 10

## Type stack

- Display + Body: Geist (weights 300–700, variable)
- Mono: Geist Mono (weights 400–500)
- Loaded via: Google Fonts `<link>` in index.html
- Mono numbers: `font-mono tabular-nums` on all metrics and scores

Banned in this project: Inter (regular), Roboto, Arial, system-ui, serif on dashboards.

## Color tokens

```css
/* Neutral family: Slate (cool blue undertone — trustworthy, institutional) */
background: #f8fafc          /* slate-50 */
surface (cards): #ffffff
foreground: #0f172a          /* slate-900 */
muted text: #64748b          /* slate-500 */
border: #e2e8f0              /* slate-200 */
sidebar bg: #020617          /* slate-950 */

/* Single accent */
accent: #2563eb              /* blue-600 — desaturated electric blue */
accent hover: #1d4ed8        /* blue-700 */

/* Status */
success: #10b981             /* emerald-500 */
warning: #f59e0b             /* amber-400 */
danger:  #f43f5e             /* rose-400/600 */
info:    #3b82f6             /* blue-500 */
```

Shadows: `0 1px 8px -2px oklch(0.3 0.01 250 / 0.06)` — tinted toward slate, never pure black.

Banned: pure #000 / #FFF, purple-to-blue gradients, `bg-gray-*` (use `bg-slate-*` consistently).

## Motion

- Spring (standard): `{ type: 'spring', stiffness: 100, damping: 20 }`
- Spring (snappy / tap): `{ type: 'spring', stiffness: 400, damping: 30 }`
- Spring (expand/collapse): `{ type: 'spring', stiffness: 200, damping: 28 }`
- CSS easing fallback: `cubic-bezier(0.16, 1, 0.3, 1)`
- Score bars: `transform: scaleX()` via CSS transition, `0.9s cubic-bezier(0.16,1,0.3,1)`
- Score ring: SVG `stroke-dashoffset` via CSS transition, `1.1s cubic-bezier(0.16,1,0.3,1)`
- Page stagger: `staggerChildren: 0.07`, `delayChildren: 0.05`
- Sidebar nav stagger: `staggerChildren: 0.06`, `delayChildren: 0.1`, slide from x: -10
- Banned: linear easing (except shimmer), bounce/elastic, animating width/height/top/left

Library: framer-motion v11

## Layout

- Container: `max-w-[1400px] mx-auto px-6 md:px-10`
- Reading width: `max-w-[65ch]` for all body text
- Section padding: `py-8 md:py-10` (daily density, VISUAL_DENSITY 4)
- App shell: fixed left sidebar 224px (`w-56`) + flex-1 main content
- Feature data: `divide-y` rows — NOT three equal cards
- Dashboard: stats strip with `divide-x` separators inside one white container, then asymmetric 2/3 + 1/3 grid
- Audit layout: fixed left category nav (208px) + scrollable right content area
- Mobile: all `grid-cols-N` collapse to single column, sidebar hidden (desktop-first for this tool)

Banned: centered hero, 3 equal feature cards, nested cards beyond depth 1, `h-screen`, flex percentage math.

## Component inventory

Custom: Layout, Sidebar, StatusBadge, SeverityBadge, AuditorAvatar, ScoreRing, ScoreBar (inline)
Pages: DashboardPage, ProjectsPage, AuditPage, GuidelinesPage, ReportsPage
State: Zustand store (`useStore`) — projects, guidelines, checklist items, audit responses

## Project-specific rules

- Compliance scores: `percentage = compliant / applicable * 100` (N/A items excluded from denominator)
- Audit progress: `progress = answered / total * 100` (all response states count)
- Score color thresholds: ≥80% emerald, ≥60% amber, <60% rose
- Platform initials: 2-char uppercase abbreviation in colored rounded square
- No round-number fake scores — all percentages are computed from real mock response data
- No generic auditor names — use Priya Nambiar, Kofi Agyemang, Lin Park-Aboagye, Dmitri Volkov

## Brand voice

- Tone: precise, institutional, direct — not chirpy
- Banned copy: elevate, seamless, unleash, next-gen, game-changing, revolutionary
- Labels: specific and factual ("Non-Compliant", "Under Review", not "Issues Found", "In Flight")
- Numbers: always tabular-nums, font-mono for metrics and scores

## Accessibility floor

- WCAG 2.2 AA contrast on all body copy (≥ 4.5:1)
- Focus-visible rings on every interactive element (`focus-visible:outline-2 focus-visible:outline-blue-400`)
- `prefers-reduced-motion` respected via CSS override in index.css
- 44×44px minimum touch targets (buttons use py-2 px-3 minimum)
- All form inputs have explicit `<label>` elements

## Last updated

2026-05-11 — Initial build: full app scaffold with Dashboard, Projects, Audit, Guidelines, Reports pages