import { describe, expect, it } from 'vitest'
import { relevantFailedPages } from '../../../../src/features/evidence/failedPages.js'
import type { AccessStatus } from '../../../../src/features/evidence/types.js'

const page = (url: string, accessStatus: AccessStatus) => ({ url, accessStatus })

describe('relevantFailedPages', () => {
  const start = ['https://p.test/safety/', 'https://p.test/privacy']

  it('keeps a start link that failed, in any way', () => {
    const pages = [page('https://p.test/safety/', 'timeout'), page('https://p.test/privacy', 'blocked')]
    expect(relevantFailedPages(pages, start)).toEqual([
      { url: 'https://p.test/safety/', status: 'timeout' },
      { url: 'https://p.test/privacy', status: 'blocked' },
    ])
  })

  it('matches a start link with or without a trailing slash or fragment', () => {
    const pages = [page('https://p.test/safety', 'error'), page('https://p.test/privacy#top', 'error')]
    expect(relevantFailedPages(pages, start)).toHaveLength(2)
  })

  it('keeps a followed link that needed a login', () => {
    const pages = [page('https://p.test/settings', 'login_required')]
    expect(relevantFailedPages(pages, start)).toEqual([{ url: 'https://p.test/settings', status: 'login_required' }])
  })

  it('drops followed links that failed for unrelated reasons', () => {
    const pages = [
      page('https://careers.p.test/', 'blocked'),
      page('https://p.test/embed', 'error'),
      page('https://p.test/slow', 'timeout'),
    ]
    expect(relevantFailedPages(pages, start)).toEqual([])
  })

  it('never lists a page that was read', () => {
    expect(relevantFailedPages([page('https://p.test/safety/', 'ok')], start)).toEqual([])
  })

  it('keeps every failed page when the start links are unknown', () => {
    const pages = [page('https://p.test/embed', 'error'), page('https://p.test/a', 'ok')]
    expect(relevantFailedPages(pages, null)).toEqual([{ url: 'https://p.test/embed', status: 'error' }])
  })
})
