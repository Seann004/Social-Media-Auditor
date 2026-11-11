import { afterEach, describe, expect, it, vi } from 'vitest'
import { permalinkOf } from './repoAddress.js'
import { ARCHIVE_URL, COMMIT_URL, createRepoRunKit, REPO_URL, SHA } from './__fixtures__/repoRunWorld.js'

const NOT_FOUND = 'The repository was not found, or it is private. Only public GitHub repositories can be read.'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a code repository run, end to end', () => {
  it('downloads the repository, judges two items from its code and ends completed', async () => {
    const kit = await createRepoRunKit()
    const run = await kit.run()

    expect(run.status).toBe('completed')
    expect(run.error).toBeNull()
    expect(run.uncheckedItemIds).toEqual([])
    expect(run.categoriesTotal).toBe(2)
    expect(run.categoriesDone).toBe(2)
    expect(run.currentItemId).toBeNull()
    expect(run.finishedAt).not.toBeNull()

    const suggestions = await kit.suggestions(run.id)
    expect(suggestions.map((s) => [s.itemId, s.source, s.suggestedResult]).sort()).toEqual([
      ['i1', 'repo', 'yes'],
      ['i2', 'repo', 'yes'],
    ])
    expect(suggestions.every((s) => s.quotes.every((q) => q.verified))).toBe(true)

    const snapshot = await kit.repoRepo.getSnapshot(run.id)
    expect(snapshot).toMatchObject({ runId: run.id, repoUrl: REPO_URL, owner: 'acme', name: 'social', branch: null, commitSha: SHA, truncated: false })
    expect(snapshot?.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(snapshot?.filesRead).toBe(3)

    const pieces = await kit.repoRepo.listPieces(run.id)
    expect(pieces.map((p) => [p.itemId, p.path])).toEqual([
      ['i1', 'src/users/createUser.ts'],
      ['i2', 'src/report/reportPost.ts'],
    ])
    for (const piece of pieces) {
      const page = await kit.repo.getPage(piece.pageId)
      expect(page?.url).toBe(permalinkOf('acme', 'social', SHA, piece.path, piece.startLine, piece.endLine))
      expect(piece.commitSha).toBe(SHA)
    }
    expect(kit.judged.flatMap((c) => c.passages.map((p) => p.text.split('\n')[0]))).toEqual([
      'File src/users/createUser.ts, lines 1–5',
      'File src/report/reportPost.ts, lines 1–3',
    ])

    // One search-words call (50 tokens) and two judge calls (100 each).
    expect(kit.groqFetch).toHaveBeenCalledTimes(1)
    expect(run.tokensUsed).toBe(250)
    expect(kit.githubFetch.mock.calls.map((c) => c[0])).toEqual([COMMIT_URL, ARCHIVE_URL])
    expect(kit.audit.applyAnswer).not.toHaveBeenCalled()
  })

  it('ends failed with the plain sentence when GitHub answers 404', async () => {
    const kit = await createRepoRunKit({ github: { [COMMIT_URL]: () => new Response('Not Found', { status: 404 }) } })
    const run = await kit.run()
    expect(run.status).toBe('failed')
    expect(run.error).toBe(NOT_FOUND)
    expect(kit.judged).toHaveLength(0)
    expect(kit.groqFetch).not.toHaveBeenCalled()
    expect(await kit.repoRepo.getSnapshot(run.id)).toBeNull()
  })

  it('a re-assess makes no GitHub call and judges the stored pieces again', async () => {
    const kit = await createRepoRunKit()
    const first = await kit.run()
    const githubCalls = kit.githubFetch.mock.calls.length
    const groqCalls = kit.groqFetch.mock.calls.length
    const firstPassages = kit.judged.map((c) => c.passages.map((p) => p.id))

    const again = await kit.run({ capturedInRunId: first.id, scope: 'all' })
    expect(again.status).toBe('completed')
    expect(kit.githubFetch.mock.calls.length).toBe(githubCalls)
    expect(kit.groqFetch.mock.calls.length).toBe(groqCalls)
    expect(kit.judged.slice(2).map((c) => c.passages.map((p) => p.id))).toEqual(firstPassages)
    const suggestions = await kit.suggestions(again.id)
    expect(suggestions.map((s) => [s.itemId, s.source]).sort()).toEqual([
      ['i1', 'repo'],
      ['i2', 'repo'],
    ])
    expect(suggestions.every((s) => s.originSuggestionId === null)).toBe(true)
    expect(await kit.repoRepo.listPieces(again.id)).toEqual([])
    expect(again.tokensUsed).toBe(200)
  })
})
