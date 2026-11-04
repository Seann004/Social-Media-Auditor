import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorld, item, page, PROJECT } from './__fixtures__/runnerWorld.js'
import type { AssessedItem, AssessInput } from './assess.js'
import { MAX_TOKENS_PER_RUN } from './config.js'
import { createMemoryRepository } from './memoryRepository.js'

const NO_TEXT_SENTENCE = 'No captured page has text that matches this item.'
const ITEM_COUNT = 10

// Ten passages of about 3 000 characters each, one per item: the call budget holds only six of them.
const marker = (k: number) => `marker${k}`
const bigPassage = (k: number) => `${marker(k)} ${Array.from({ length: 150 }, () => 'internationalization').join(' ')}`
const BIG_PAGE = page('https://p.test/policy', Array.from({ length: ITEM_COUNT }, (_, k) => bigPassage(k)).join('\n\n'))
const ITEMS = Array.from({ length: ITEM_COUNT }, (_, k) => item(`b${k}`, 'Policy', `Is ${marker(k)} documented?`))

/** Answers every item with a quote from the passage that holds its marker, and says so when it has none. */
function answerFromMarkers(input: AssessInput, tokensUsed = 100) {
  const results: AssessedItem[] = input.items.map((it) => {
    const own = input.passages.find((p) => p.text.startsWith(marker(Number(it.id.slice(1)))))
    return {
      itemId: it.id,
      suggestedResult: 'yes',
      reason: `Answer for ${it.id}`,
      quotes: own ? [{ passageId: own.id, text: own.text.split(' ').slice(0, 4).join(' ') }] : [],
      evidenceSufficient: true,
      conflicting: false,
      webAssessable: true,
      confidence: 'high',
    }
  })
  return { results, missingItemIds: [], tokensUsed }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('items whose passages did not fit the call', () => {
  it('get a further call, and never the no-text sentence', async () => {
    const world = await createWorld({ items: ITEMS, pages: [BIG_PAGE], assess: (input) => answerFromMarkers(input) })

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    expect(run.status).toBe('completed')
    expect(world.calls.assess.length).toBeGreaterThan(1)
    expect(suggestions).toHaveLength(ITEM_COUNT)
    for (const s of suggestions) {
      expect(s.reason).not.toBe(NO_TEXT_SENTENCE)
      expect(s.suggestedResult).toBe('yes')
      expect(s.quotes[0].verified).toBe(true)
    }
    // Each item is asked once, and only in a call that carries one of its own passages.
    const asked = world.calls.assess.flatMap((c) => c.items.map((i) => i.id))
    expect([...asked].sort()).toEqual(ITEMS.map((i) => i.id).sort())
    for (const call of world.calls.assess) {
      for (const it of call.items) {
        expect(call.passages.some((p) => p.text.startsWith(marker(Number(it.id.slice(1)))))).toBe(true)
      }
    }
  })

  it('stops at the token cap, leaving those items without a suggestion and their category unassessed', async () => {
    const world = await createWorld({ items: ITEMS, pages: [BIG_PAGE], assess: (input) => answerFromMarkers(input, MAX_TOKENS_PER_RUN) })

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    expect(world.calls.assess).toHaveLength(1)
    expect(run.status).toBe('partial')
    expect(run.unassessedCategories).toEqual(['g1__Policy'])
    expect(run.tokensUsed).toBe(MAX_TOKENS_PER_RUN)
    expect(suggestions.length).toBeLessThan(ITEM_COUNT)
    expect(suggestions.some((s) => s.reason === NO_TEXT_SENTENCE)).toBe(false)
  })

  it('counts a passage that was dropped as not sent when its quote is checked', async () => {
    const repo = createMemoryRepository()
    const world = await createWorld({ repo, items: ITEMS, pages: [BIG_PAGE] })
    // The search is by capture run, which is the latest run once this one has started.
    world.deps.assessBatch = async (input) => {
      world.calls.assess.push(input)
      const out = answerFromMarkers(input)
      if (world.calls.assess.length !== 1) return out
      const run = await repo.latestRun(PROJECT)
      const dropped = (await repo.searchPassages(run?.id ?? '', marker(9), 1))[0]
      expect(input.passages.some((p) => p.id === dropped.id)).toBe(false)
      const quote = { passageId: dropped.id, text: dropped.text.split(' ').slice(0, 4).join(' ') }
      return { ...out, results: out.results.map((r, i) => (i === 0 ? { ...r, quotes: [quote] } : r)) }
    }

    const run = await world.run()
    const first = (await world.suggestions(run.id)).find((s) => s.itemId === 'b0')

    expect(first?.quotes[0].verified).toBe(false)
    expect(first?.flags.map((f) => f.type)).toContain('unverified_quote')
  })
})

describe('the passages sent are recorded with every suggestion (spec 7.5)', () => {
  it('stores the ids carried by the call that made each suggestion, and none when there was no call', async () => {
    const items = [...ITEMS, item('bare', 'Policy', 'Zebra giraffe elephant?')]
    const world = await createWorld({ items, pages: [BIG_PAGE], assess: (input) => answerFromMarkers(input) })

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    expect(world.calls.assess.length).toBeGreaterThan(1)
    for (const s of suggestions.filter((x) => x.itemId !== 'bare')) {
      const call = world.calls.assess.find((c) => c.items.some((i) => i.id === s.itemId))
      expect(call).toBeDefined()
      expect(s.passageIdsSent).toEqual(call?.passages.map((p) => p.id))
      expect(s.passageIdsSent.length).toBeGreaterThan(0)
    }
    expect(suggestions.find((s) => s.itemId === 'bare')?.passageIdsSent).toEqual([])
  })

  it('keeps the original list on a carried suggestion', async () => {
    const world = await createWorld({ items: ITEMS.slice(0, 2), pages: [BIG_PAGE], assess: (input) => answerFromMarkers(input) })
    const first = await world.run()
    const original = await world.suggestions(first.id)
    world.deps.assessBatch = async () => {
      throw new Error('Groq request failed with status 429')
    }

    const second = await world.run({ scope: 'all', capturedInRunId: first.id })
    const carried = await world.suggestions(second.id)

    expect(carried.map((s) => s.passageIdsSent)).toEqual(original.map((s) => s.passageIdsSent))
    expect(carried[0].passageIdsSent.length).toBeGreaterThan(0)
  })
})
