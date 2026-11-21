import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroqLimitError } from '../../../../src/lib/groq.js'
import { createWorld, PROJECT, quoteFirstPassage, THREE_CATEGORIES, type World } from '../../../fixtures/runnerWorld.js'
import type { AssessInput, AssessOutput } from '../../../../src/features/evidence/assess.js'
import type { Decision, Suggestion } from '../../../../src/features/evidence/types.js'
import { latestDecisionViews } from '../../../../src/features/evidence/views.js'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

const withReason = (input: AssessInput, reason: string): AssessOutput => {
  const out = quoteFirstPassage(input)
  return { ...out, results: out.results.map((r) => ({ ...r, reason })) }
}

/** Assesses this many calls, then hits Groq's daily limit. */
const limitAfter = (calls: number, reason = 'fresh') => {
  let made = 0
  return async (input: AssessInput): Promise<AssessOutput> => {
    made += 1
    if (made > calls) throw new GroqLimitError(7200)
    return withReason(input, reason)
  }
}
const noLimit = (reason = 'fresh') => limitAfter(Number.MAX_SAFE_INTEGER, reason)

function accept(world: World, s: Suggestion): Promise<Decision> {
  return world.repo.addDecision({
    suggestionId: s.id,
    projectId: PROJECT,
    itemId: s.itemId,
    userId: 'u1',
    decision: 'accepted',
    finalResult: 'compliant',
    overrideReason: null,
    origin: 'card',
  })
}

function override(world: World, s: Suggestion): Promise<Decision> {
  return world.repo.addDecision({
    suggestionId: s.id,
    projectId: PROJECT,
    itemId: s.itemId,
    userId: 'u1',
    decision: 'overridden',
    finalResult: 'non_compliant',
    overrideReason: 'The page is out of date.',
    origin: 'card',
  })
}

const byItem = (suggestions: Suggestion[], itemId: string): Suggestion => {
  const found = suggestions.find((s) => s.itemId === itemId)
  if (!found) throw new Error(`no suggestion for ${itemId}`)
  return found
}

async function viewsOf(world: World, runId: string) {
  const current = await world.suggestions(runId)
  const views = await latestDecisionViews(world.repo, PROJECT, current)
  return { current, view: (itemId: string) => views.find((v) => v.itemId === itemId) }
}

/** Run one assesses Privacy (i1, i2) and is stopped by the limit before Reporting and Safety. */
async function firstRunHitsLimit(): Promise<{ world: World; firstRunId: string; first: Suggestion[] }> {
  const world = await createWorld({ items: THREE_CATEGORIES })
  world.deps.assessBatch = limitAfter(1, 'first')
  const run = await world.run()
  expect(run.status).toBe('partial')
  return { world, firstRunId: run.id, first: await world.suggestions(run.id) }
}

describe('a decision on a suggestion that was carried forward', () => {
  it('still belongs to the suggestion after "Re-assess unfinished" (the Groq limit scenario)', async () => {
    const { world, firstRunId, first } = await firstRunHitsLimit()
    await accept(world, byItem(first, 'i1'))
    await override(world, byItem(first, 'i2'))
    world.deps.assessBatch = noLimit()

    const second = await world.run({ scope: 'unfinished', capturedInRunId: firstRunId })

    expect(second.status).toBe('completed')
    const { current, view } = await viewsOf(world, second.id)
    expect(byItem(current, 'i1').id).not.toBe(byItem(first, 'i1').id)
    expect(view('i1')).toMatchObject({ suggestionId: byItem(current, 'i1').id, decision: 'accepted', suggestedResult: 'yes' })
    expect(view('i2')).toMatchObject({
      suggestionId: byItem(current, 'i2').id,
      decision: 'overridden',
      finalResult: 'non_compliant',
      overrideReason: 'The page is out of date.',
      suggestedResult: 'yes',
    })
  })

  it('stores where a copy came from, and nothing on a suggestion the run assessed itself', async () => {
    const { world, firstRunId, first } = await firstRunHitsLimit()
    expect(first.map((s) => s.originSuggestionId)).toEqual([null, null])
    world.deps.assessBatch = noLimit()

    const second = await world.run({ scope: 'unfinished', capturedInRunId: firstRunId })

    const current = await world.suggestions(second.id)
    expect(byItem(current, 'i1').originSuggestionId).toBe(byItem(first, 'i1').id)
    expect(byItem(current, 'i3').originSuggestionId).toBeNull()
  })

  it('survives two re-assess cycles, with decisions on the first row and on a copy', async () => {
    const { world, firstRunId, first } = await firstRunHitsLimit()
    await accept(world, byItem(first, 'i1'))

    // Cycle one: Reporting is assessed, Safety is stopped by the limit again.
    world.deps.assessBatch = limitAfter(1, 'second')
    const second = await world.run({ scope: 'unfinished', capturedInRunId: firstRunId })
    expect(second.status).toBe('partial')
    const copies = await world.suggestions(second.id)
    await override(world, byItem(copies, 'i2'))
    await accept(world, byItem(copies, 'i3'))

    // Cycle two: Safety is assessed; all the rest are copies, some of copies.
    world.deps.assessBatch = noLimit('third')
    const third = await world.run({ scope: 'unfinished', capturedInRunId: firstRunId })
    expect(third.status).toBe('completed')

    const { current, view } = await viewsOf(world, third.id)
    // A copy of a copy names the first row, not the copy it was made from.
    expect(byItem(current, 'i2').originSuggestionId).toBe(byItem(first, 'i2').id)
    expect(byItem(current, 'i3').originSuggestionId).toBe(byItem(copies, 'i3').id)
    expect(view('i1')?.suggestionId).toBe(byItem(current, 'i1').id)
    expect(view('i2')?.suggestionId).toBe(byItem(current, 'i2').id)
    expect(view('i3')?.suggestionId).toBe(byItem(current, 'i3').id)
    expect(view('i2')).toMatchObject({ decision: 'overridden', suggestedResult: 'yes' })
  })

  it('reads only what the current suggestions cannot answer', async () => {
    const { world, firstRunId, first } = await firstRunHitsLimit()
    await accept(world, byItem(first, 'i1'))
    world.deps.assessBatch = limitAfter(1, 'second')
    const second = await world.run({ scope: 'unfinished', capturedInRunId: firstRunId })
    const copies = await world.suggestions(second.id)
    await override(world, byItem(copies, 'i2'))
    world.deps.assessBatch = noLimit('third')
    const third = await world.run({ scope: 'unfinished', capturedInRunId: firstRunId })
    const read = vi.spyOn(world.repo, 'getSuggestionSummaries')

    await viewsOf(world, third.id)

    // i1 was decided on the origin of its current copy, so only the middle copy of i2 needs a read.
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith([byItem(copies, 'i2').id])
  })

  it('needs no read at all when every decision is on a current suggestion or its origin', async () => {
    const { world, firstRunId, first } = await firstRunHitsLimit()
    await accept(world, byItem(first, 'i1'))
    await override(world, byItem(first, 'i2'))
    world.deps.assessBatch = noLimit()
    const second = await world.run({ scope: 'unfinished', capturedInRunId: firstRunId })
    const read = vi.spyOn(world.repo, 'getSuggestionSummaries')

    await viewsOf(world, second.id)

    expect(read).not.toHaveBeenCalled()
  })
})

describe('a decision on a suggestion that was assessed again', () => {
  it('keeps its own id when "all" produces a fresh suggestion, so the card can say what changed', async () => {
    const world = await createWorld({ items: THREE_CATEGORIES })
    const firstRun = await world.run()
    const first = await world.suggestions(firstRun.id)
    await accept(world, byItem(first, 'i1'))
    world.deps.assessBatch = noLimit('fresh')

    const second = await world.run({ scope: 'all', capturedInRunId: firstRun.id })

    const { current, view } = await viewsOf(world, second.id)
    expect(byItem(current, 'i1').originSuggestionId).toBeNull()
    expect(byItem(current, 'i1').reason).toBe('fresh')
    expect(view('i1')?.suggestionId).toBe(byItem(first, 'i1').id)
    expect(view('i1')?.suggestionId).not.toBe(byItem(current, 'i1').id)
  })

  it('treats the fresh and the carried items of one "all" run each as they are', async () => {
    const world = await createWorld({ items: THREE_CATEGORIES })
    const firstRun = await world.run()
    const first = await world.suggestions(firstRun.id)
    await accept(world, byItem(first, 'i1'))
    await accept(world, byItem(first, 'i3'))
    // Privacy is assessed afresh; the limit stops Reporting, which is carried.
    world.deps.assessBatch = limitAfter(1, 'fresh')

    const second = await world.run({ scope: 'all', capturedInRunId: firstRun.id })

    const { current, view } = await viewsOf(world, second.id)
    expect(view('i1')?.suggestionId).toBe(byItem(first, 'i1').id)
    expect(view('i3')?.suggestionId).toBe(byItem(current, 'i3').id)
  })

  it('does not join the line of the fresh suggestion when that one is carried on later', async () => {
    const world = await createWorld({ items: THREE_CATEGORIES })
    const firstRun = await world.run()
    const first = await world.suggestions(firstRun.id)
    await accept(world, byItem(first, 'i1'))
    await accept(world, byItem(first, 'i3'))
    world.deps.assessBatch = noLimit('fresh')
    const second = await world.run({ scope: 'all', capturedInRunId: firstRun.id })
    const fresh = await world.suggestions(second.id)
    // A later decision on the fresh i3 follows it; i1 was decided only on the replaced row.
    await override(world, byItem(fresh, 'i3'))
    world.deps.assessBatch = limitAfter(0)

    const third = await world.run({ scope: 'all', capturedInRunId: firstRun.id })

    const { current, view } = await viewsOf(world, third.id)
    expect(byItem(current, 'i1').originSuggestionId).toBe(byItem(fresh, 'i1').id)
    expect(view('i1')?.suggestionId).toBe(byItem(first, 'i1').id)
    expect(view('i3')?.suggestionId).toBe(byItem(current, 'i3').id)
    expect(view('i3')?.decision).toBe('overridden')
  })
})
