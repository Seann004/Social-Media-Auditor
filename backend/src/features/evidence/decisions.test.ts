import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppliedAnswer, ApplyAnswerInput, AuditData } from './auditData.js'
import { ACCEPTED_EVIDENCE_LINK_SECONDS } from './config.js'
import { DecisionError, latestDecisionPerItem, recordDecision } from './decisions.js'
import { createMemoryRepository } from './memoryRepository.js'
import type { NewSuggestion } from './repository.js'
import type { Decision, SuggestedResult, SuggestionQuote } from './types.js'

type World = ReturnType<typeof makeWorld>

function makeWorld() {
  const repo = createMemoryRepository()
  let signs = 0
  const screenshots = {
    ...repo,
    signedUrl: vi.fn(async (path: string, seconds: number) => {
      signs += 1
      return `${await repo.signedUrl(path, seconds)}&n=${signs}`
    }),
  }
  const applied: ApplyAnswerInput[] = []
  const audit = {
    status: 'not_submitted' as string | null,
    items: [{ id: 'i1', guidelineId: 'g1', category: 'Privacy', name: 'n', text: 't', helpText: null }],
    listChecklistItems: async () => audit.items,
    getSubmissionStatus: async () => audit.status,
    applyAnswer: vi.fn(async (input: ApplyAnswerInput): Promise<AppliedAnswer> => {
      applied.push(input)
      return { itemId: input.itemId, status: input.result, findings: input.findingsIfEmpty ?? null, evidenceImages: input.addImages ?? [] }
    }),
  }
  return { repo, screenshots, audit, applied, deps: { repo, audit: audit as unknown as AuditData, screenshots } }
}

type Quote = Omit<SuggestionQuote, 'id'>

async function seed(
  w: World,
  over: Partial<NewSuggestion> = {},
  quotes: ((pageId: string) => Quote[]) | null = null,
) {
  const page = await w.repo.addPage('run1', {
    url: 'https://p.test/a', finalUrl: null, httpStatus: 200, accessStatus: 'ok', accessDetail: null,
    title: 't', text: 'x', accessibilitySnapshot: null, screenshotPath: 'p1/run1/page-a.jpg', contentHash: null,
  })
  await w.repo.upload('p1/run1/page-a.jpg', Buffer.from('x'))
  await w.repo.upload('p1/run1/hl-1.jpg', Buffer.from('x'))
  await w.repo.upload('p1/run1/hl-2.jpg', Buffer.from('x'))
  const defaults: Quote[] = [
    { passageId: 'x', pageId: page.id, quoteText: 'q1', verified: true, highlightScreenshotPath: 'p1/run1/hl-1.jpg' },
    { passageId: 'x', pageId: page.id, quoteText: 'q2', verified: true, highlightScreenshotPath: 'p1/run1/hl-2.jpg' },
  ]
  return w.repo.addSuggestion({
    runId: 'run1', projectId: 'p1', itemId: 'i1', suggestedResult: 'yes', reason: 'The page says so.',
    confidence: 'high', flags: [], passageIdsSent: [], quotes: quotes ? quotes(page.id) : defaults, ...over,
  })
}

const accept = (w: World, suggestionId: string, userId = 'u1') =>
  recordDecision({ suggestionId, userId, decision: 'accepted', origin: 'card' }, w.deps)

const override = (w: World, suggestionId: string, extra: Partial<Parameters<typeof recordDecision>[0]> = {}) =>
  recordDecision(
    { suggestionId, userId: 'u1', decision: 'overridden', finalResult: 'non_compliant', overrideReason: 'Checked by hand', origin: 'card', ...extra },
    w.deps,
  )

const failsWith = async (p: Promise<unknown>, status: number) => {
  const err = await p.then(() => null, (e: unknown) => e)
  expect(err).toBeInstanceOf(DecisionError)
  expect((err as DecisionError).status).toBe(status)
}

describe('recordDecision', () => {
  let w: World
  beforeEach(() => { w = makeWorld() })

  it('accept sets the answer to the suggested result and records the decision', async () => {
    const s = await seed(w)
    const { decision, answer } = await accept(w, s.id)
    expect(w.applied[0]).toMatchObject({ projectId: 'p1', itemId: 'i1', guidelineId: 'g1', userId: 'u1', result: 'compliant' })
    expect(answer.status).toBe('compliant')
    expect(decision).toMatchObject({ suggestionId: s.id, projectId: 'p1', itemId: 'i1', userId: 'u1', decision: 'accepted', finalResult: 'compliant', overrideReason: null, origin: 'card' })
    expect(await w.repo.listDecisions('p1')).toHaveLength(1)
  })

  it.each([['yes', 'compliant'], ['no', 'non_compliant'], ['partially', 'partially'], ['not_applicable', 'not_applicable']] as [SuggestedResult, string][])(
    'accept maps %s to %s', async (suggested, status) => {
      const s = await seed(w, { suggestedResult: suggested })
      expect((await accept(w, s.id)).decision.finalResult).toBe(status)
    })

  it('accept offers the AI reason only as the fallback for empty findings', async () => {
    const s = await seed(w)
    await accept(w, s.id)
    expect(w.applied[0].findingsIfEmpty).toBe('The page says so.')
    expect(w.applied[0]).not.toHaveProperty('findings')
  })

  it('accept adds highlight screenshots, named stably, signed for the accepted-evidence period', async () => {
    const s = await seed(w)
    await accept(w, s.id)
    expect(w.applied[0].addImages?.map((i) => i.name)).toEqual(['AI evidence hl-1.jpg', 'AI evidence hl-2.jpg'])
    expect(w.screenshots.signedUrl).toHaveBeenCalledWith('p1/run1/hl-1.jpg', ACCEPTED_EVIDENCE_LINK_SECONDS)
    expect(w.applied[0].addImages?.[0].url).toContain(`expires=${ACCEPTED_EVIDENCE_LINK_SECONDS}`)
  })

  it('accepting twice offers the same names even though the links differ', async () => {
    const s = await seed(w)
    await accept(w, s.id)
    await accept(w, s.id)
    expect(w.applied[1].addImages?.map((i) => i.name)).toEqual(w.applied[0].addImages?.map((i) => i.name))
    expect(w.applied[1].addImages?.[0].url).not.toBe(w.applied[0].addImages?.[0].url)
  })

  it('attaches at most the highlight limit', async () => {
    const s = await seed(w, {}, (pageId) => [1, 2, 3].map((n) => ({ passageId: 'x', pageId, quoteText: `q${n}`, verified: true, highlightScreenshotPath: `p1/run1/hl-${Math.min(n, 2)}.jpg` })))
    await accept(w, s.id)
    expect(w.applied[0].addImages).toHaveLength(2)
  })

  it('falls back to the page screenshot for a verified quote without a close-up, once per page', async () => {
    const s = await seed(w, {}, (pageId) => [
      { passageId: 'x', pageId, quoteText: 'q1', verified: true, highlightScreenshotPath: null },
      { passageId: 'x', pageId, quoteText: 'q2', verified: true, highlightScreenshotPath: null },
    ])
    await accept(w, s.id)
    expect(w.applied[0].addImages?.map((i) => i.name)).toEqual(['AI evidence page-a.jpg'])
  })

  it('unverified quotes attach nothing, and the accept still succeeds', async () => {
    const s = await seed(w, {}, (pageId) => [
      { passageId: null, pageId, quoteText: 'made up', verified: false, highlightScreenshotPath: 'p1/run1/hl-1.jpg' },
    ])
    await accept(w, s.id)
    expect(w.applied[0].addImages ?? []).toEqual([])
    expect(await w.repo.listDecisions('p1')).toHaveLength(1)
  })

  it('a signing failure skips that picture, logs, and still records the decision', async () => {
    const s = await seed(w)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    w.screenshots.signedUrl.mockImplementationOnce(async () => { throw new Error('storage down') })
    await accept(w, s.id)
    expect(w.applied[0].addImages?.map((i) => i.name)).toEqual(['AI evidence hl-2.jpg'])
    expect(spy).toHaveBeenCalled()
    expect(await w.repo.listDecisions('p1')).toHaveLength(1)
    spy.mockRestore()
  })

  it('accept on a null suggestion is 422 and writes nothing', async () => {
    const s = await seed(w, { suggestedResult: null })
    await failsWith(accept(w, s.id), 422)
    expect(w.applied).toHaveLength(0)
    expect(await w.repo.listDecisions('p1')).toHaveLength(0)
  })

  it('override requires a final result and a reason of at least 3 characters', async () => {
    const s = await seed(w)
    await failsWith(override(w, s.id, { finalResult: undefined }), 422)
    await failsWith(override(w, s.id, { finalResult: 'bogus' as never }), 422)
    await failsWith(override(w, s.id, { overrideReason: undefined }), 422)
    await failsWith(override(w, s.id, { overrideReason: ' a ' }), 422)
    expect(w.applied).toHaveLength(0)
    expect(await w.repo.listDecisions('p1')).toHaveLength(0)
  })

  it('override to the suggested result is 422', async () => {
    const s = await seed(w)
    await failsWith(override(w, s.id, { finalResult: 'compliant' }), 422)
  })

  it('override leaves findings and photos untouched', async () => {
    const s = await seed(w)
    const { decision } = await override(w, s.id, { overrideReason: '  Checked by hand  ' })
    expect(w.applied[0]).toEqual({ projectId: 'p1', itemId: 'i1', guidelineId: 'g1', userId: 'u1', result: 'non_compliant' })
    expect(decision).toMatchObject({ decision: 'overridden', finalResult: 'non_compliant', overrideReason: 'Checked by hand' })
    expect(w.screenshots.signedUrl).not.toHaveBeenCalled()
  })

  it('override of a null suggestion is allowed', async () => {
    const s = await seed(w, { suggestedResult: null })
    await override(w, s.id)
    expect(w.applied).toHaveLength(1)
  })

  it('a decision on a submitted or approved audit is 409 and writes nothing', async () => {
    const s = await seed(w)
    for (const status of ['pending_review', 'approved']) {
      w.audit.status = status
      await failsWith(accept(w, s.id), 409)
    }
    expect(w.applied).toHaveLength(0)
    expect(await w.repo.listDecisions('p1')).toHaveLength(0)
  })

  it('an unknown suggestion, a gone project and a gone item are 404', async () => {
    await failsWith(accept(w, 'nope'), 404)
    const s = await seed(w)
    w.audit.status = null
    await failsWith(accept(w, s.id), 404)
    w.audit.status = 'not_submitted'
    w.audit.items = []
    await failsWith(accept(w, s.id), 404)
    expect(w.applied).toHaveLength(0)
  })

  it('takes project and item from the suggestion, and the user from the caller', async () => {
    const s = await seed(w)
    await accept(w, s.id, 'someone')
    expect(w.applied[0]).toMatchObject({ projectId: 'p1', itemId: 'i1', userId: 'someone' })
  })

  it('a decision-write failure throws, and the retry succeeds', async () => {
    const s = await seed(w)
    vi.spyOn(w.repo, 'addDecision').mockRejectedValueOnce(new Error('db down'))
    await expect(accept(w, s.id)).rejects.toThrow('db down')
    await accept(w, s.id)
    expect(await w.repo.listDecisions('p1')).toHaveLength(1)
  })

  it('two auditors deciding: both stay in history and the latest wins', async () => {
    const s = await seed(w)
    await accept(w, s.id, 'a')
    await override(w, s.id, { userId: 'b' })
    const all = await w.repo.listDecisions('p1')
    expect(all).toHaveLength(2)
    expect(latestDecisionPerItem(all).get('i1')).toMatchObject({ userId: 'b', decision: 'overridden' })
  })

  it('allows a decision on a suggestion from an older run', async () => {
    const old = await seed(w)
    await seed(w, { runId: 'run2' })
    await accept(w, old.id)
    expect(await w.repo.listDecisions('p1')).toHaveLength(1)
  })
})

describe('latestDecisionPerItem', () => {
  const d = (id: string, itemId: string, decidedAt: string): Decision => ({
    id, suggestionId: 's', projectId: 'p', itemId, userId: 'u', decision: 'accepted', finalResult: 'compliant',
    overrideReason: null, origin: 'card', decidedAt,
  })

  it('picks the latest by decidedAt, per item', () => {
    const m = latestDecisionPerItem([d('1', 'a', '2026-01-02'), d('2', 'a', '2026-01-01'), d('3', 'b', '2026-01-01')])
    expect(m.get('a')?.id).toBe('1')
    expect(m.get('b')?.id).toBe('3')
  })

  it('breaks a tie by list order', () => {
    const m = latestDecisionPerItem([d('1', 'a', '2026-01-01'), d('2', 'a', '2026-01-01')])
    expect(m.get('a')?.id).toBe('2')
  })
})
