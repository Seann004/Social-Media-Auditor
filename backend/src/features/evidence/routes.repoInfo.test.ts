import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRepoRepository, type MemoryRepoRepository } from './memoryRepoRepository.js'
import { P1, USERS, makeWorld, type World } from './routesTestKit.js'
import type { NewSuggestion } from './repository.js'

interface RepoWorld extends World {
  repoRepo: MemoryRepoRepository
}

function setup(): RepoWorld {
  const repoRepo = createMemoryRepoRepository()
  return { ...makeWorld({ deps: { repoRepo } }), repoRepo }
}

/** A finished repo capture run with a snapshot at `sha` and one stored piece for each of `pieceItems`. */
async function repoCapture(w: RepoWorld, sha: string, pieceItems: string[]) {
  const run = await w.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all', source: 'repo', checkedItemIds: ['item-1', 'item-2', 'item-3'] })
  await w.repoRepo.saveSnapshot({ runId: run.id, repoUrl: 'https://github.com/octo/app', owner: 'octo', name: 'app', branch: null, commitSha: sha, filesRead: 1, filesSkipped: 0, truncated: false })
  const pages = []
  for (const itemId of pieceItems) {
    const url = `https://github.com/octo/app/blob/${sha}/src/${itemId}.ts#L1-L2`
    const page = await w.repo.addPage(run.id, {
      url, finalUrl: url, httpStatus: null, accessStatus: 'ok', accessDetail: null, title: 'h',
      text: `File src/${itemId}.ts, lines 1–2\ncode()`, accessibilitySnapshot: null, screenshotPath: null, contentHash: 'h',
    })
    await w.repoRepo.addPieces([{ runId: run.id, itemId, pageId: page.id, path: `src/${itemId}.ts`, startLine: 1, endLine: 2, commitSha: sha, round: 1 }])
    pages.push(page)
  }
  return { run, pages }
}

const suggestion = (runId: string, itemId: string, over: Partial<NewSuggestion> = {}): NewSuggestion => ({
  runId, projectId: P1, itemId, suggestedResult: null, reason: 'r', confidence: 'low', flags: [], passageIdsSent: [], source: 'repo', quotes: [], ...over,
})

async function list(w: World) {
  const res = await request(w.app).get(`/api/projects/${P1}/ai-suggestions`).set(w.auth(USERS.auditor))
  expect(res.status).toBe(200)
  return res.body.suggestions as { id: string; itemId: string; commitSha: string | null; hasCode: boolean; quotes: { pageHasScreenshot: boolean }[] }[]
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('the suggestion listing, for repo suggestions', () => {
  it('carries the commit and whether code is there, so the card needs no second request', async () => {
    const w = setup()
    const { run, pages } = await repoCapture(w, 'abc1234def', ['item-1'])
    await w.repo.addSuggestion(suggestion(run.id, 'item-1', { quotes: [{ passageId: null, pageId: pages[0].id, quoteText: 'code()', verified: true, highlightScreenshotPath: null }] }))
    await w.repo.addSuggestion(suggestion(run.id, 'item-2'))
    await w.repo.addSuggestion(suggestion(run.id, 'item-3', { passageIdsSent: ['passage-9'] }))
    await w.repo.updateRun(run.id, { status: 'completed' })
    const byItem = new Map((await list(w)).map((s) => [s.itemId, s]))
    expect(byItem.get('item-1')).toMatchObject({ commitSha: 'abc1234def', hasCode: true })
    // No piece and nothing sent: no code matched, so the card offers no "Code found".
    expect(byItem.get('item-2')).toMatchObject({ commitSha: 'abc1234def', hasCode: false })
    expect(byItem.get('item-3')).toMatchObject({ commitSha: 'abc1234def', hasCode: true })
    // A code piece has no screenshot: the card must not ask for one.
    expect(byItem.get('item-1')!.quotes[0].pageHasScreenshot).toBe(false)
  })

  it('a copy carried forward shows the commit of the capture its origin came from, read once per capture', async () => {
    const w = setup()
    const first = await repoCapture(w, 'aaaa111', ['item-1'])
    const origin = await w.repo.addSuggestion(suggestion(first.run.id, 'item-1'))
    await w.repo.updateRun(first.run.id, { status: 'completed' })
    const second = await repoCapture(w, 'bbbb222', ['item-2'])
    await w.repo.addSuggestion(suggestion(second.run.id, 'item-1', { originSuggestionId: origin.id }))
    await w.repo.addSuggestion(suggestion(second.run.id, 'item-2'))
    await w.repo.updateRun(second.run.id, { status: 'completed' })
    const snapshots = vi.spyOn(w.repoRepo, 'getSnapshot')
    const byItem = new Map((await list(w)).map((s) => [s.itemId, s]))
    expect(byItem.get('item-1')).toMatchObject({ commitSha: 'aaaa111', hasCode: true })
    expect(byItem.get('item-2')).toMatchObject({ commitSha: 'bbbb222', hasCode: true })
    expect(snapshots).toHaveBeenCalledTimes(2)
  })

  it('a repo suggestion whose snapshot is missing has no commit; other sources carry none', async () => {
    const w = setup()
    const run = await w.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all', source: 'repo' })
    await w.repo.addSuggestion(suggestion(run.id, 'item-1'))
    await w.repo.updateRun(run.id, { status: 'completed' })
    expect((await list(w))[0]).toMatchObject({ commitSha: null, hasCode: false })

    const pagesRun = await w.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    await w.repo.addSuggestion(suggestion(pagesRun.id, 'item-1', { source: 'pages', passageIdsSent: ['p1'] }))
    await w.repo.updateRun(pagesRun.id, { status: 'completed' })
    expect((await list(w))[0]).toMatchObject({ commitSha: null, hasCode: false })
  })
})

describe('the suggestion listing: quote pictures', () => {
  it('says whether the page of a quote has a screenshot', async () => {
    const w = setup()
    const run = await w.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all', source: 'app' })
    const base = { finalUrl: null, httpStatus: null, accessStatus: 'ok' as const, accessDetail: null, title: 't', text: 'x', accessibilitySnapshot: null, contentHash: null }
    const shot = await w.repo.addPage(run.id, { ...base, url: 'https://app.test/a', screenshotPath: 'p/r/a.jpg' })
    const none = await w.repo.addPage(run.id, { ...base, url: 'https://app.test/b', screenshotPath: null })
    const quote = (pageId: string) => ({ passageId: null, pageId, quoteText: 'x', verified: true, highlightScreenshotPath: null })
    await w.repo.addSuggestion(suggestion(run.id, 'item-1', { source: 'app', quotes: [quote(shot.id), quote(none.id)] }))
    await w.repo.updateRun(run.id, { status: 'completed' })
    expect((await list(w))[0].quotes.map((q) => q.pageHasScreenshot)).toEqual([true, false])
  })
})
