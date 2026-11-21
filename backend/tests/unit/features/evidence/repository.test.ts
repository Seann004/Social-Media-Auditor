import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { EvidenceRepository, NewSuggestion } from '../../../../src/features/evidence/repository.js'
import { createMemoryRepository } from '../../../../src/features/evidence/memoryRepository.js'
import { createSupabaseRepository } from '../../../../src/features/evidence/supabaseRepository.js'
import { APP_PROMPT_VERSION, PROMPT_VERSION } from '../../../../src/features/evidence/config.js'

interface Harness {
  repo: EvidenceRepository
  projectId: string
  itemId: string
  cleanup: () => Promise<void>
}

type Factory = () => Harness

const memoryFactory: Factory = () => ({
  repo: createMemoryRepository(),
  projectId: randomUUID(),
  itemId: randomUUID(),
  cleanup: async () => {},
})

// Needs a dedicated project and checklist item: cleanup deletes the feature's rows for that project.
const supabaseFactory: Factory = () => {
  const url = process.env.SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const projectId = process.env.EVIDENCE_TEST_PROJECT_ID ?? ''
  const itemId = process.env.EVIDENCE_TEST_ITEM_ID ?? ''
  if (!url || !key || !projectId || !itemId) {
    throw new Error(
      'EVIDENCE_TEST_SUPABASE needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EVIDENCE_TEST_PROJECT_ID, EVIDENCE_TEST_ITEM_ID',
    )
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })
  return {
    repo: createSupabaseRepository(admin),
    projectId,
    itemId,
    cleanup: async () => {
      for (const table of ['Evidence_Run', 'Evidence_Source', 'Evidence_Permission']) {
        const { error } = await admin.from(table).delete().eq('projectId', projectId)
        if (error) throw new Error(`cleanup ${table}: ${error.message}`)
      }
    },
  }
}

const variants: [string, Factory][] = [['memory', memoryFactory]]
if (process.env.EVIDENCE_TEST_SUPABASE === 'true') variants.push(['supabase', supabaseFactory])

describe.each(variants)('evidence repository (%s)', (variant, factory) => {
  let h: Harness
  beforeEach(() => {
    h = factory()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const newRun = (extra: Record<string, unknown> = {}) =>
    h.repo.createRun({ projectId: h.projectId, startedBy: null, scope: 'all', ...extra })

  const pageInput = (url = 'https://example.com/') => ({
    url,
    finalUrl: url,
    httpStatus: 200,
    accessStatus: 'ok' as const,
    accessDetail: null,
    title: 'Home',
    text: 'hello',
    accessibilitySnapshot: null,
    screenshotPath: null,
    contentHash: 'abc',
  })

  const SENT = [randomUUID(), randomUUID()]
  const suggestion = (runId: string, quoteCount = 1): NewSuggestion => ({
    runId,
    projectId: h.projectId,
    itemId: h.itemId,
    suggestedResult: 'yes',
    reason: 'because',
    confidence: 'high',
    flags: [{ type: 'low_confidence', reason: 'r' }],
    passageIdsSent: SENT,
    quotes: Array.from({ length: quoteCount }, (_, i) => ({
      passageId: null,
      pageId: null,
      quoteText: `quote ${i}`,
      verified: false,
      highlightScreenshotPath: null,
    })),
  })

  it('creates a capture run that points at itself and reads it back', async () => {
    const run = await newRun()
    expect(run.status).toBe('queued')
    expect(run.capturedInRunId).toBe(run.id)
    expect(await h.repo.getRun(run.id)).toEqual(run)
    expect(await h.repo.getRun(randomUUID())).toBeNull()
  })

  it('updateRun patches fields and keeps the rest', async () => {
    const run = await newRun()
    const updated = await h.repo.updateRun(run.id, { status: 'capturing', pagesDone: 2 })
    expect(updated.status).toBe('capturing')
    expect(updated.pagesDone).toBe(2)
    expect(updated.projectId).toBe(h.projectId)
  })

  it('latestResultRun ignores queued, running and failed runs and returns partial runs', async () => {
    expect(await h.repo.latestResultRun(h.projectId)).toBeNull()
    const done = await newRun()
    await h.repo.updateRun(done.id, { status: 'completed' })
    const partial = await newRun()
    await h.repo.updateRun(partial.id, { status: 'partial' })
    const failed = await newRun()
    await h.repo.updateRun(failed.id, { status: 'failed' })
    await newRun()
    const running = await newRun()
    await h.repo.updateRun(running.id, { status: 'capturing' })
    expect((await h.repo.latestResultRun(h.projectId))?.id).toBe(partial.id)
    expect((await h.repo.latestRun(h.projectId))?.id).toBe(running.id)
  })

  it('activeRun returns the latest queued, capturing or assessing run only', async () => {
    const a = await newRun()
    await h.repo.updateRun(a.id, { status: 'completed' })
    expect(await h.repo.activeRun(h.projectId)).toBeNull()
    const b = await newRun()
    await h.repo.updateRun(b.id, { status: 'assessing' })
    expect((await h.repo.activeRun(h.projectId))?.id).toBe(b.id)
  })

  it('countRunsSince counts runs created at or after the cut-off', async () => {
    await newRun()
    await newRun()
    expect(await h.repo.countRunsSince(h.projectId, '2000-01-01T00:00:00.000Z')).toBe(2)
    expect(await h.repo.countRunsSince(h.projectId, '2999-01-01T00:00:00.000Z')).toBe(0)
  })

  it('markInterruptedRuns fails queued, capturing and assessing runs with "server restarted"', async () => {
    // The method is global (no project filter), so the live variant skips it to protect real runs.
    if (variant !== 'memory') return
    const queued = await newRun()
    const capturing = await newRun()
    await h.repo.updateRun(capturing.id, { status: 'capturing' })
    const assessing = await newRun()
    await h.repo.updateRun(assessing.id, { status: 'assessing' })
    const done = await newRun()
    await h.repo.updateRun(done.id, { status: 'completed' })

    expect(await h.repo.markInterruptedRuns()).toBe(3)
    for (const r of [queued, capturing, assessing]) {
      const got = await h.repo.getRun(r.id)
      expect(got?.status).toBe('failed')
      expect(got?.error).toBe('server restarted')
      expect(got?.finishedAt).not.toBeNull()
    }
    expect((await h.repo.getRun(done.id))?.status).toBe('completed')
  })

  it('saves and reads the source and the latest permission', async () => {
    expect(await h.repo.getSource(h.projectId)).toBeNull()
    expect(await h.repo.getPermission(h.projectId)).toBeNull()
    await h.repo.saveSource(h.projectId, ['https://a.example/'], null)
    await h.repo.saveSource(h.projectId, ['https://b.example/'], null)
    expect((await h.repo.getSource(h.projectId))?.startUrls).toEqual(['https://b.example/'])
    await h.repo.setPermission(h.projectId, true, 'ok', null)
    await h.repo.setPermission(h.projectId, false, null, null)
    expect((await h.repo.getPermission(h.projectId))?.granted).toBe(false)
  })

  it('stores pages and returns them for the capture run', async () => {
    const run = await newRun()
    const page = await h.repo.addPage(run.id, pageInput())
    expect(await h.repo.getPage(page.id)).toEqual(page)
    expect((await h.repo.listPages(run.id)).map((p) => p.id)).toEqual([page.id])
  })

  it('listPageSummaries returns only what the views need, in capture order', async () => {
    const run = await newRun()
    const a = await h.repo.addPage(run.id, { ...pageInput('https://example.com/a'), screenshotPath: 'p/a.jpg', accessibilitySnapshot: { big: true } })
    const b = await h.repo.addPage(run.id, pageInput('https://example.com/b'))
    const summaries = await h.repo.listPageSummaries(run.id)
    expect(summaries.map((p) => p.id)).toEqual([a.id, b.id])
    expect(Object.keys(summaries[0]).sort()).toEqual(
      ['accessDetail', 'accessStatus', 'capturedAt', 'finalUrl', 'httpStatus', 'id', 'screenshotPath', 'title', 'url'].sort(),
    )
    expect(summaries[0].screenshotPath).toBe('p/a.jpg')
    expect(await h.repo.listPageSummaries(randomUUID())).toEqual([])
  })

  it('getSuggestionSummaries reads the result and origin of many suggestions at once and skips unknown ids', async () => {
    const run = await newRun()
    const later = await newRun()
    const a = await h.repo.addSuggestion({ ...suggestion(run.id), suggestedResult: 'no' })
    const b = await h.repo.addSuggestion({ ...suggestion(later.id), suggestedResult: 'no', originSuggestionId: a.id })
    const missing = randomUUID()
    const got = await h.repo.getSuggestionSummaries([a.id, b.id, missing])
    expect(got).toEqual({
      [a.id]: { suggestedResult: 'no', originSuggestionId: null },
      [b.id]: { suggestedResult: 'no', originSuggestionId: a.id },
    })
    expect(await h.repo.getSuggestionSummaries([])).toEqual({})
  })

  it('getSuggestionRunIds reads the run of many suggestions at once and skips unknown ids', async () => {
    const run = await newRun()
    const later = await newRun()
    const a = await h.repo.addSuggestion(suggestion(run.id))
    const b = await h.repo.addSuggestion({ ...suggestion(later.id), originSuggestionId: a.id })
    expect(await h.repo.getSuggestionRunIds([a.id, b.id, randomUUID()])).toEqual({ [a.id]: run.id, [b.id]: later.id })
    expect(await h.repo.getSuggestionRunIds([])).toEqual({})
  })

  it('addPassages returns the saved passages', async () => {
    const run = await newRun()
    const page = await h.repo.addPage(run.id, pageInput())
    const saved = await h.repo.addPassages(page.id, [
      { position: 0, kind: 'text', text: 'first' },
      { position: 1, kind: 'controls', text: 'second' },
    ])
    expect(saved.map((p) => [p.position, p.kind, p.text, p.pageId])).toEqual([
      [0, 'text', 'first', page.id],
      [1, 'controls', 'second', page.id],
    ])
    expect(saved[0].id).toBeTruthy()
  })

  it('searchPassages matches ANY query term, not all of them, best match first', async () => {
    const run = await newRun()
    const page = await h.repo.addPage(run.id, pageInput())
    await h.repo.addPassages(page.id, [
      { position: 0, kind: 'text', text: 'Our privacy policy explains cookies and retention.' },
      { position: 1, kind: 'text', text: 'Contact us about retention only.' },
      { position: 2, kind: 'text', text: 'Weather is lovely today.' },
    ])
    const found = await h.repo.searchPassages(run.id, 'privacy policy retention', 10)
    expect(found.map((p) => p.position)).toEqual([0, 1])
    expect((await h.repo.searchPassages(run.id, 'privacy policy retention', 1)).length).toBe(1)
  })

  it('searchPassages only searches the given run', async () => {
    const r1 = await newRun()
    const r2 = await newRun()
    const p1 = await h.repo.addPage(r1.id, pageInput())
    const p2 = await h.repo.addPage(r2.id, pageInput())
    await h.repo.addPassages(p1.id, [{ position: 0, kind: 'text', text: 'accessibility statement' }])
    await h.repo.addPassages(p2.id, [{ position: 0, kind: 'text', text: 'accessibility statement' }])
    const found = await h.repo.searchPassages(r1.id, 'accessibility', 10)
    expect(found.map((p) => p.pageId)).toEqual([p1.id])
  })

  it('searchPassages returns [] for a query with only stop words', async () => {
    const run = await newRun()
    const page = await h.repo.addPage(run.id, pageInput())
    await h.repo.addPassages(page.id, [{ position: 0, kind: 'text', text: 'the and of to is' }])
    expect(await h.repo.searchPassages(run.id, 'the and of is', 10)).toEqual([])
    expect(await h.repo.searchPassages(run.id, '', 10)).toEqual([])
  })

  it('adds a suggestion with its quotes and reads it back', async () => {
    const run = await newRun()
    const saved = await h.repo.addSuggestion(suggestion(run.id, 2))
    expect(saved.quotes.length).toBe(2)
    expect(saved.passageIdsSent).toEqual(SENT)
    expect(saved.originSuggestionId).toBeNull()
    expect(await h.repo.getSuggestion(saved.id)).toEqual(saved)
    expect(await h.repo.listSuggestions(run.id)).toEqual([saved])
    expect(await h.repo.getQuote(saved.quotes[0].id)).toEqual(saved.quotes[0])
    expect(await h.repo.getQuote(randomUUID())).toBeNull()
  })

  it('stores and reads back the suggestion a copy came from', async () => {
    const first = await h.repo.addSuggestion(suggestion((await newRun()).id))
    const copy = await h.repo.addSuggestion({ ...suggestion((await newRun()).id), originSuggestionId: first.id })
    expect(copy.originSuggestionId).toBe(first.id)
    expect(await h.repo.getSuggestion(copy.id)).toEqual(copy)
    expect(await h.repo.listSuggestions(copy.runId)).toEqual([copy])
  })

  it('rejects a second suggestion for the same run and item', async () => {
    const run = await newRun()
    await h.repo.addSuggestion(suggestion(run.id))
    await expect(h.repo.addSuggestion(suggestion(run.id))).rejects.toThrow()
    expect((await h.repo.listSuggestions(run.id)).length).toBe(1)
  })

  it('listDecisions returns every decision, so history is kept', async () => {
    const run = await newRun()
    const s = await h.repo.addSuggestion(suggestion(run.id))
    const base = {
      suggestionId: s.id,
      projectId: h.projectId,
      itemId: h.itemId,
      userId: null,
      origin: 'card' as const,
    }
    const first = await h.repo.addDecision({ ...base, decision: 'accepted', finalResult: 'compliant', overrideReason: null })
    const second = await h.repo.addDecision({ ...base, decision: 'overridden', finalResult: 'non_compliant', overrideReason: 'wrong' })
    expect((await h.repo.listDecisions(h.projectId)).map((d) => d.id)).toEqual([first.id, second.id])
  })

  it('a new run defaults to source pages with empty checked and unchecked items and step 0', async () => {
    const run = await newRun()
    expect(run.source).toBe('pages')
    expect(run.checkedItemIds).toEqual([])
    expect(run.uncheckedItemIds).toEqual([])
    expect(run.currentItemId).toBeNull()
    expect(run.currentStep).toBe(0)
    expect(run.promptVersion).toBe(PROMPT_VERSION)
    expect(await h.repo.getRun(run.id)).toEqual(run)
  })

  it('an app run keeps source, checkedItemIds and promptVersion as given', async () => {
    const run = await newRun({ source: 'app', checkedItemIds: [h.itemId], promptVersion: APP_PROMPT_VERSION })
    expect(run.source).toBe('app')
    expect(run.checkedItemIds).toEqual([h.itemId])
    expect(run.promptVersion).toBe(APP_PROMPT_VERSION)
    expect(await h.repo.getRun(run.id)).toEqual(run)
  })

  it('updateRun saves currentItemId, currentStep and uncheckedItemIds', async () => {
    const run = await newRun({ source: 'app' })
    const other = randomUUID()
    const updated = await h.repo.updateRun(run.id, { currentItemId: h.itemId, currentStep: 4, uncheckedItemIds: [other] })
    expect(updated.currentItemId).toBe(h.itemId)
    expect(updated.currentStep).toBe(4)
    expect(updated.uncheckedItemIds).toEqual([other])
    expect(await h.repo.getRun(run.id)).toEqual(updated)
  })

  it('a suggestion keeps its source; one added without a source is pages', async () => {
    const run = await newRun()
    const plain = await h.repo.addSuggestion(suggestion(run.id))
    expect(plain.source).toBe('pages')
    const appRun = await newRun({ source: 'app' })
    const fromApp = await h.repo.addSuggestion({ ...suggestion(appRun.id), source: 'app' })
    expect(fromApp.source).toBe('app')
    expect(await h.repo.getSuggestion(fromApp.id)).toEqual(fromApp)
    expect((await h.repo.listSuggestions(appRun.id))[0].source).toBe('app')
  })

  it('listPassagesOfPages returns only those pages, in page order then position', async () => {
    const run = await newRun()
    const a = await h.repo.addPage(run.id, pageInput('https://example.com/a'))
    const b = await h.repo.addPage(run.id, pageInput('https://example.com/b'))
    const c = await h.repo.addPage(run.id, pageInput('https://example.com/c'))
    await h.repo.addPassages(a.id, [{ position: 0, kind: 'text', text: 'a0' }, { position: 1, kind: 'text', text: 'a1' }])
    await h.repo.addPassages(b.id, [{ position: 1, kind: 'text', text: 'b1' }, { position: 0, kind: 'text', text: 'b0' }])
    await h.repo.addPassages(c.id, [{ position: 0, kind: 'text', text: 'c0' }])
    const got = await h.repo.listPassagesOfPages([b.id, a.id])
    expect(got.map((p) => p.text)).toEqual(['b0', 'b1', 'a0', 'a1'])
    expect(await h.repo.listPassagesOfPages([])).toEqual([])
    expect((await h.repo.listPassagesOfPages([a.id, a.id])).map((p) => p.text)).toEqual(['a0', 'a1'])
  })

  it('getPageSummaries returns the summaries of the given ids, across runs, without text', async () => {
    const r1 = await newRun()
    const r2 = await newRun()
    const a = await h.repo.addPage(r1.id, { ...pageInput('https://example.com/a'), screenshotPath: 'p/a.jpg' })
    const b = await h.repo.addPage(r2.id, pageInput('https://example.com/b'))
    await h.repo.addPage(r2.id, pageInput('https://example.com/c'))
    const got = await h.repo.getPageSummaries([a.id, b.id, randomUUID()])
    expect(got.map((p) => p.id).sort()).toEqual([a.id, b.id].sort())
    expect(Object.keys(got[0]).sort()).toEqual(
      ['accessDetail', 'accessStatus', 'capturedAt', 'finalUrl', 'httpStatus', 'id', 'screenshotPath', 'title', 'url'].sort(),
    )
    expect(await h.repo.getPageSummaries([])).toEqual([])
  })

  it('returns copies, so changing a result does not change stored data', async () => {
    if (variant !== 'memory') return
    const run = await newRun()
    const got = await h.repo.getRun(run.id)
    got!.status = 'failed'
    got!.unassessedCategories.push('x')
    expect((await h.repo.getRun(run.id))?.status).toBe('queued')
    expect((await h.repo.getRun(run.id))?.unassessedCategories).toEqual([])
  })
})
