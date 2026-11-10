/**
 * Whether the auditor's screen offers "Public pages" as an evidence source.
 * The owner's audits cover social media apps, so it is hidden. The public-pages code (capture,
 * assessment, routes) is intact and old pages runs still display. Set to `true` to bring the
 * option back exactly as it was.
 */
export const PUBLIC_PAGES_ENABLED = false

/**
 * The E2E build sets VITE_E2E_PUBLIC_PAGES=true (see playwright.config.ts) so the pages-flow
 * specs can run. Nothing else reads it; unset, the constant above decides.
 */
export const PUBLIC_PAGES_ENABLED_IN_BUILD: boolean =
  PUBLIC_PAGES_ENABLED || import.meta.env.VITE_E2E_PUBLIC_PAGES === 'true'
