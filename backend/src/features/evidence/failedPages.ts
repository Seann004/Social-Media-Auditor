import type { AccessStatus } from './types.js'

export interface FailedPage {
  url: string
  status: AccessStatus
}

/** Compares urls the way a person would: no fragment, and no trailing slash on the path. */
function comparable(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.origin}${path}${u.search}`
  } catch {
    return url.trim()
  }
}

/**
 * The pages that count towards the "inaccessible" flag. A crawl follows many links, and
 * most failures among them (a careers site, an embed page) say nothing about the checklist.
 * So only these count: a start link the auditor gave, whatever went wrong; and any page
 * that needed a login, since settings pages behind a login are where evidence often is.
 * When the start links can't be read, every failed page counts, the cautious direction.
 */
export function relevantFailedPages(
  pages: { url: string; accessStatus: AccessStatus }[],
  startUrls: string[] | null,
): FailedPage[] {
  const starts = startUrls ? new Set(startUrls.map(comparable)) : null
  return pages
    .filter((p) => p.accessStatus !== 'ok')
    .filter((p) => !starts || starts.has(comparable(p.url)) || p.accessStatus === 'login_required')
    .map((p) => ({ url: p.url, status: p.accessStatus }))
}
