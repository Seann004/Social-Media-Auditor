# Design

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
Login card: `0 24px 64px -12px oklch(0.08 0.01 250 / 0.55), 0 4px 16px -4px oklch(0.15 0.02 250 / 0.2)`
Logo glow: `0 4px 12px oklch(0.45 0.2 250 / 0.35)` — directional, not omnidirectional neon.



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

## Component inventory

Custom: Layout, Sidebar, StatusBadge, SeverityBadge, AuditorAvatar, ScoreRing, ScoreBar (inline)
Pages: DashboardPage, ProjectsPage, AuditPage, GuidelinesPage, ReportsPage
State: Zustand store (`useStore`) — projects, guidelines, checklist items, audit responses

## Login page pattern

Card-first: logo lives inside the card (not floating above), topped by a 3px blue accent strip. Background is slate-950 + subtle 52px grid at 3% opacity.

## Project-specific rules

- Compliance scores: `percentage = compliant / applicable * 100` (N/A items excluded from denominator)
- Audit progress: `progress = answered / total * 100` (all response states count)
- Score color thresholds: ≥80% emerald, ≥60% amber, <60% rose
- Platform initials: 2-char uppercase abbreviation in colored rounded square
- No round-number fake scores — all percentages are computed from real mock response data
