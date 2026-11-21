import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorld, item, page, quoteFirstPassage } from '../../../fixtures/runnerWorld.js'
import { clearVectorCache, MIN_PASSAGE_SIMILARITY } from '../../../../src/features/evidence/passageSearch.js'

// The item asks about teen accounts being private by default. This passage says it with none of those words.
const PARAPHRASE = 'Profiles of young members stay hidden from strangers until a parent approves each viewer.'
const UNRELATED = 'Our company was founded in a garage and now has offices in many cities around the world.'
const TEXT = `${UNRELATED}\n\n${PARAPHRASE}`
const ITEMS = [item('i1', 'Privacy', 'Are teen accounts private by default?')]

const vectorOf = (text: string): number[] => (text.includes('Profiles of young members') ? [0.95, 0.1] : text.includes('teen accounts') ? [1, 0] : [0, 1])

function fakeEmbedder(calls: string[][] = []) {
  return {
    model: 'test-model',
    embed: vi.fn(async (texts: readonly string[]) => {
      calls.push([...texts])
      return texts.map(vectorOf)
    }),
  }
}

const sentTexts = (assess: { passages: { text: string }[] }[]) => assess.flatMap((c) => c.passages.map((p) => p.text))

beforeEach(() => {
  clearVectorCache()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

async function world() {
  return createWorld({ items: ITEMS, pages: [page('https://p.test/privacy', TEXT)], assess: (input) => quoteFirstPassage(input) })
}

describe('searching passages by meaning as well as by words', () => {
  it('sends a passage that shares no words with the item when its meaning is close', async () => {
    const w = await world()
    w.deps.embedder = fakeEmbedder()
    const run = await w.run()
    expect(sentTexts(w.calls.assess)).toContain(PARAPHRASE)
    expect(run.status).toBe('completed')
  })

  it('finds nothing for that item with words alone, which is the gap this closes', async () => {
    const w = await world()
    await w.run()
    expect(sentTexts(w.calls.assess)).not.toContain(PARAPHRASE)
  })

  it('does not send a passage whose vector is far from the question', async () => {
    const w = await world()
    w.deps.embedder = fakeEmbedder()
    await w.run()
    expect(sentTexts(w.calls.assess)).not.toContain(UNRELATED)
  })

  it('keeps the passages that the keyword search finds', async () => {
    const w = await createWorld({ items: ITEMS, pages: [page('https://p.test/privacy', `${TEXT}\n\nTeen accounts are private by default.`)], assess: (input) => quoteFirstPassage(input) })
    w.deps.embedder = fakeEmbedder()
    await w.run()
    expect(sentTexts(w.calls.assess)).toContain('Teen accounts are private by default.')
  })

  it('makes each passage vector once, however many items ask', async () => {
    const calls: string[][] = []
    const w = await createWorld({
      items: [...ITEMS, item('i2', 'Privacy', 'Is the default for teen accounts private?')],
      pages: [page('https://p.test/privacy', TEXT)],
      assess: (input) => quoteFirstPassage(input),
    })
    w.deps.embedder = fakeEmbedder(calls)
    await w.run()
    const passageRequests = calls.flat().filter((t) => !t.startsWith('Represent this sentence'))
    expect(new Set(passageRequests).size).toBe(passageRequests.length)
  })

  it('uses only the keyword search when the embedding service fails, and still completes', async () => {
    const w = await createWorld({ items: ITEMS, pages: [page('https://p.test/privacy', `${TEXT}\n\nTeen accounts are private by default.`)], assess: (input) => quoteFirstPassage(input) })
    w.deps.embedder = { model: 'test-model', embed: vi.fn(async () => { throw new Error('service down') }) }
    const run = await w.run()
    expect(run.status).toBe('completed')
    expect(sentTexts(w.calls.assess)).toContain('Teen accounts are private by default.')
  })

  it('never offers the text of a page that needed a login', async () => {
    const login = page('https://p.test/account', PARAPHRASE, { accessStatus: 'login_required', accessDetail: 'The page is a login form.' })
    const w = await createWorld({ items: ITEMS, pages: [page('https://p.test/privacy', UNRELATED), login], assess: (input) => quoteFirstPassage(input) })
    w.deps.embedder = fakeEmbedder()
    await w.run()
    expect(sentTexts(w.calls.assess)).not.toContain(PARAPHRASE)
  })

  it('has a similarity floor between related and unrelated vectors', () => {
    expect(MIN_PASSAGE_SIMILARITY).toBeGreaterThan(0.5)
  })
})
