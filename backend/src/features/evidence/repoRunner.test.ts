import { afterEach, describe, expect, it, vi } from 'vitest'
import { GroqLimitError } from '../../lib/groq.js'
import { APP_RUN_TIMEOUT_MS, MAX_TOKENS_PER_RUN, RUN_TIMEOUT_MS } from './config.js'
import { runEvidenceJob } from './runner.js'
import { runTimeoutMsOf } from './runStart.js'
import { PROJECT } from './__fixtures__/runnerWorld.js'
import { createRepoRunKit, quoteFirstCodeLine, termsReply } from './__fixtures__/repoRunWorld.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const limitOn = (itemId: string) => (input: Parameters<typeof quoteFirstCodeLine>[0]) => {
  if (input.items[0].id === itemId) throw new GroqLimitError(7200)
  return quoteFirstCodeLine(input)
}

describe('executeRepoRun: capture', () => {
  it('goes capturing, then assessing with the picked items as the total, and moves currentItemId item by item', async () => {
    const kit = await createRepoRunKit()
    const update = vi.spyOn(kit.repo, 'updateRun')
    await kit.run()
    const patches = update.mock.calls.map((c) => c[1])
    const statuses = patches.flatMap((p) => (p.status ? [p.status] : []))
    expect(statuses).toEqual(['capturing', 'assessing', 'completed'])
    expect(patches.find((p) => p.status === 'assessing')).toMatchObject({ categoriesTotal: 2 })
    expect(patches.flatMap((p) => (p.currentItemId === undefined ? [] : [p.currentItemId]))).toEqual(['i1', 'i2', null])
  })

  it('a Groq limit on item 2 keeps item 1 and ends partial with the app-style sentence', async () => {
    const kit = await createRepoRunKit()
    kit.judge.current = limitOn('i2')
    const run = await kit.run()
    expect(run.status).toBe('partial')
    expect(run.error).toBe('AI daily limit reached; 1 item not checked')
    expect(run.uncheckedItemIds).toEqual(['i2'])
    expect((await kit.suggestions(run.id)).map((s) => s.itemId)).toEqual(['i1'])
    // Item 2's pieces were stored before the limit, so a re-assess can judge them.
    expect((await kit.repoRepo.listPieces(run.id, 'i2')).length).toBeGreaterThan(0)
  })

  it('a Groq limit on the search-words call ends partial with nothing judged', async () => {
    const kit = await createRepoRunKit()
    kit.groqFetch.mockImplementation(async () => new Response('{}', { status: 429, headers: { 'retry-after': '7200' } }))
    const run = await kit.run()
    expect(run.status).toBe('partial')
    expect(run.error).toBe('AI daily limit reached; 2 items not checked')
    expect(kit.judged).toHaveLength(0)
    expect(await kit.repoRepo.getSnapshot(run.id)).not.toBeNull()
  })

  it('searches with the items’ own words when the search-words call fails for another reason', async () => {
    const kit = await createRepoRunKit()
    kit.groqFetch.mockImplementation(async () => new Response('{}', { status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = await kit.run({ checkedItemIds: ['i2'] })
    // "report" from the item's own text finds reportPost.ts.
    expect(run.status).toBe('completed')
    expect((await kit.repoRepo.listPieces(run.id, 'i2')).map((p) => p.path)).toEqual(['src/report/reportPost.ts'])
  })

  it('reaching the token cap ends partial with the budget sentence', async () => {
    const kit = await createRepoRunKit()
    kit.judge.current = (input) => quoteFirstCodeLine(input, MAX_TOKENS_PER_RUN)
    const run = await kit.run()
    expect(run.status).toBe('partial')
    expect(run.error).toBe('The AI budget for one run was used up; 1 item not checked')
    expect(run.uncheckedItemIds).toEqual(['i2'])
    expect(kit.judged).toHaveLength(1)
    expect(run.tokensUsed).toBe(MAX_TOKENS_PER_RUN + 50)
  })

  it('running out of time ends partial with the timeout sentence', async () => {
    const kit = await createRepoRunKit()
    kit.groqFetch.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return termsReply(['i1', 'i2'])
    })
    kit.deps.runTimeoutMs = 10
    const run = await kit.run()
    expect(run.status).toBe('partial')
    expect(run.error).toBe('The run ran out of time; 2 items not checked')
    expect(kit.judged).toHaveLength(0)
  })

  it('carries forward a pages suggestion for an item it did not pick', async () => {
    const kit = await createRepoRunKit()
    const pages = await kit.repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })
    await kit.repo.addSuggestion({
      runId: pages.id,
      projectId: PROJECT,
      itemId: 'i3',
      suggestedResult: 'no',
      reason: 'From the pages.',
      confidence: 'medium',
      flags: [],
      passageIdsSent: [],
      source: 'pages',
      quotes: [],
    })
    await kit.repo.updateRun(pages.id, { status: 'completed', finishedAt: new Date().toISOString() })
    const run = await kit.run()
    expect(run.status).toBe('completed')
    const suggestions = await kit.suggestions(run.id)
    expect(suggestions.map((s) => [s.itemId, s.source]).sort()).toEqual([
      ['i1', 'repo'],
      ['i2', 'repo'],
      ['i3', 'pages'],
    ])
  })

  it('ends failed when the server has no code repository wiring', async () => {
    const kit = await createRepoRunKit()
    kit.deps.code = null
    const run = await kit.run()
    expect(run).toMatchObject({ status: 'failed', error: "Reading code repositories isn't configured on this server." })
  })

  it('ends failed when the repository address was removed', async () => {
    const kit = await createRepoRunKit({ saveSource: false })
    const run = await kit.run()
    expect(run).toMatchObject({ status: 'failed', error: 'The repository address was removed before the run started.' })
    expect(kit.githubFetch).not.toHaveBeenCalled()
  })

  it('reads neither robots.txt nor the permission, and opens no browser', async () => {
    const kit = await createRepoRunKit()
    const getPermission = vi.spyOn(kit.repo, 'getPermission')
    const run = await kit.run()
    expect(run.status).toBe('completed')
    expect(getPermission).not.toHaveBeenCalled()
    expect(kit.deps.browserProvider).not.toHaveBeenCalled()
  })

  it('uses the pages run timeout for a repo run', () => {
    expect(runTimeoutMsOf({ source: 'repo' })).toBe(RUN_TIMEOUT_MS)
    expect(runTimeoutMsOf({ source: 'repo' })).not.toBe(APP_RUN_TIMEOUT_MS)
  })
})

describe('executeRepoRun: re-assess', () => {
  it('re-assess unfinished judges only the items with no suggestion', async () => {
    const kit = await createRepoRunKit()
    kit.judge.current = limitOn('i2')
    const first = await kit.run()
    expect(first.status).toBe('partial')
    kit.judge.current = (input) => quoteFirstCodeLine(input)
    const before = kit.judged.length

    const again = await kit.run({ capturedInRunId: first.id, scope: 'unfinished' })
    expect(again.status).toBe('completed')
    expect(again.categoriesTotal).toBe(1)
    expect(kit.judged.slice(before).map((c) => c.items.map((i) => i.id))).toEqual([['i2']])
    expect(kit.githubFetch).toHaveBeenCalledTimes(2)
    const suggestions = await kit.suggestions(again.id)
    const byItem = new Map(suggestions.map((s) => [s.itemId, s]))
    expect(byItem.get('i1')?.originSuggestionId).not.toBeNull()
    expect(byItem.get('i2')?.originSuggestionId).toBeNull()
    expect(byItem.get('i2')?.source).toBe('repo')
  })

  it('an item the capture never reached stays not checked and is not given the no-code reason', async () => {
    const kit = await createRepoRunKit()
    kit.judge.current = (input) => quoteFirstCodeLine(input, MAX_TOKENS_PER_RUN)
    const first = await kit.run()
    expect(first.uncheckedItemIds).toEqual(['i2'])
    expect(await kit.repoRepo.listPieces(first.id, 'i2')).toEqual([])
    kit.judge.current = (input) => quoteFirstCodeLine(input)

    const again = await kit.run({ capturedInRunId: first.id, scope: 'all' })
    expect(again.status).toBe('partial')
    expect(again.uncheckedItemIds).toEqual(['i2'])
    expect((await kit.suggestions(again.id)).map((s) => s.itemId)).toEqual(['i1'])
  })

  it('ends failed when the snapshot of the capture is gone', async () => {
    const kit = await createRepoRunKit()
    const first = await kit.run()
    kit.repoRepo.removeRun(first.id)
    const again = await kit.run({ capturedInRunId: first.id, scope: 'all' })
    expect(again.status).toBe('failed')
    expect(again.error).toBe('The code this run was made from is no longer stored. Start a new code run.')
  })
})

describe('runEvidenceJob dispatch', () => {
  it('sends a repo run to the repo pipeline, not the pages capture', async () => {
    const kit = await createRepoRunKit()
    const created = await kit.repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all', source: 'repo', checkedItemIds: ['i1'] })
    await runEvidenceJob(created.id, kit.deps)
    expect((await kit.repo.getRun(created.id))?.status).toBe('completed')
    expect(kit.githubFetch).toHaveBeenCalled()
  })
})
