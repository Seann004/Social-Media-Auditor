import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroqLimitError } from '../../lib/groq.js'
import { answer, createWorld, DEFAULT_ITEMS, PROJECT, quoteFirstPassage, THREE_CATEGORIES } from './__fixtures__/runnerWorld.js'
import type { Suggestion } from './types.js'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

const itemIds = (suggestions: Suggestion[]) => suggestions.map((s) => s.itemId).sort()

/** A first run that finishes Privacy and is stopped by the limit before Reporting and Safety. */
async function firstRunHitsLimit() {
  let limited = true
  const world = await createWorld({
    items: THREE_CATEGORIES,
    highlights: async (opts) => new Map(opts.quotes.map((q) => [q, Buffer.from('img')])),
    assess: (input, call) => {
      if (limited && call === 2) throw new GroqLimitError(7200)
      return quoteFirstPassage(input)
    },
  })
  const first = await world.run()
  return { world, first, lift: () => (limited = false) }
}

describe('re-assess', () => {
  it('scope "unfinished" reuses pages and only assesses unfinished categories', async () => {
    const { world, first, lift } = await firstRunHitsLimit()
    expect(first.status).toBe('partial')
    lift()
    const assessedBefore = world.calls.assess.length

    const second = await world.run({ scope: 'unfinished', capturedInRunId: first.id })

    expect(world.calls.capture).toHaveLength(1)
    expect(second.capturedInRunId).toBe(first.id)
    expect(second.status).toBe('completed')
    expect(second.categoriesTotal).toBe(2)
    expect(second.categoriesDone).toBe(2)
    const asked = world.calls.assess.slice(assessedBefore).flatMap((c) => c.items.map((i) => i.id))
    expect(asked.sort()).toEqual(['i3', 'i4'])
    expect(await world.repo.listPages(second.id)).toEqual([])
  })

  it('scope "all" reuses pages and assesses all categories', async () => {
    const { world, first, lift } = await firstRunHitsLimit()
    lift()
    const assessedBefore = world.calls.assess.length

    const second = await world.run({ scope: 'all', capturedInRunId: first.id })

    expect(world.calls.capture).toHaveLength(1)
    expect(second.status).toBe('completed')
    expect(second.categoriesDone).toBe(3)
    const asked = world.calls.assess.slice(assessedBefore).flatMap((c) => c.items.map((i) => i.id))
    expect(asked.sort()).toEqual(['i1', 'i2', 'i3', 'i4'])
  })

  it('completes with nothing to do when no category is unfinished', async () => {
    const world = await createWorld()
    const first = await world.run()
    expect(first.status).toBe('completed')
    const before = world.calls.assess.length

    const second = await world.run({ scope: 'unfinished', capturedInRunId: first.id })

    expect(second.status).toBe('completed')
    expect(second.categoriesTotal).toBe(0)
    expect(world.calls.assess).toHaveLength(before)
    expect(itemIds(await world.suggestions(second.id))).toEqual(['i1', 'i2', 'i3'])
  })

  it('fails with a clear error when the earlier pages cannot be used', async () => {
    const world = await createWorld({ pages: [] })
    const first = await world.run()
    expect(first.status).toBe('failed')

    const second = await world.run({ scope: 'all', capturedInRunId: first.id })

    expect(second.status).toBe('failed')
    expect(world.calls.assess).toHaveLength(0)
  })

  it('opens no browser for a re-assess that has no quote to highlight', async () => {
    const world = await createWorld({ items: DEFAULT_ITEMS.slice(0, 1) })
    const first = await world.run()
    expect(world.calls.browsers).toBe(1)
    world.deps.assessBatch = async (input) => ({
      results: input.items.map((it) => ({
        itemId: it.id,
        suggestedResult: 'yes' as const,
        reason: 'r',
        quotes: [],
        evidenceSufficient: true,
        conflicting: false,
        webAssessable: true,
        confidence: 'high' as const,
      })),
      missingItemIds: [],
      tokensUsed: 1,
    })

    const second = await world.run({ scope: 'all', capturedInRunId: first.id })

    expect(second.status).toBe('completed')
    expect(world.calls.browsers).toBe(1)
    expect(world.calls.capture).toHaveLength(1)
  })

  describe('keeps earlier suggestions visible after a re-assess', () => {
    it('for scope "unfinished", carrying the finished categories forward unchanged', async () => {
      const { world, first, lift } = await firstRunHitsLimit()
      const before = await world.suggestions(first.id)
      lift()

      const second = await world.run({ scope: 'unfinished', capturedInRunId: first.id })
      const after = await world.suggestions(second.id)

      expect(itemIds(after)).toEqual(['i1', 'i2', 'i3', 'i4'])
      for (const old of before) {
        const carried = after.find((s) => s.itemId === old.itemId)
        expect(carried).toMatchObject({ suggestedResult: old.suggestedResult, reason: old.reason, confidence: old.confidence, flags: old.flags })
        expect(carried?.id).not.toBe(old.id)
        expect(carried?.runId).toBe(second.id)
        expect(carried?.quotes.map((q) => [q.quoteText, q.verified, q.pageId, q.passageId, q.highlightScreenshotPath])).toEqual(
          old.quotes.map((q) => [q.quoteText, q.verified, q.pageId, q.passageId, q.highlightScreenshotPath]),
        )
      }
      expect(before[0].quotes[0].highlightScreenshotPath).not.toBeNull()
      // What was carried is not counted as done by this run.
      expect(second.categoriesDone).toBe(2)
      // The run that was shown before is untouched.
      expect(itemIds(await world.suggestions(first.id))).toEqual(['i1', 'i2'])
    })

    it('for scope "all", carrying forward the categories a limit hit midway left undone', async () => {
      const world = await createWorld({ items: THREE_CATEGORIES })
      const first = await world.run()
      expect(first.status).toBe('completed')
      const earlier = await world.suggestions(first.id)
      let calls = 0
      world.deps.assessBatch = async (input) => {
        calls += 1
        if (calls === 2) throw new GroqLimitError(7200)
        return { ...quoteFirstPassage(input), results: quoteFirstPassage(input).results.map((r) => ({ ...r, reason: 'new reason' })) }
      }

      const second = await world.run({ scope: 'all', capturedInRunId: first.id })
      const after = await world.suggestions(second.id)

      expect(second.status).toBe('partial')
      expect(second.categoriesDone).toBe(1)
      expect(second.unassessedCategories).toEqual(['g1__Reporting', 'g1__Safety'])
      expect(itemIds(after)).toEqual(['i1', 'i2', 'i3', 'i4'])
      expect(after.filter((s) => s.reason === 'new reason').map((s) => s.itemId).sort()).toEqual(['i1', 'i2'])
      const carried = after.find((s) => s.itemId === 'i3')
      expect(carried?.reason).toBe(earlier.find((s) => s.itemId === 'i3')?.reason)
    })

    it('for scope "all", keeps every earlier suggestion when the limit is hit straight away', async () => {
      const world = await createWorld({ items: THREE_CATEGORIES })
      const first = await world.run()
      expect(first.status).toBe('completed')
      world.deps.assessBatch = async () => {
        throw new GroqLimitError(7200)
      }

      const second = await world.run({ scope: 'all', capturedInRunId: first.id })
      const after = await world.suggestions(second.id)

      expect(second.status).toBe('partial')
      expect(second.categoriesDone).toBe(0)
      expect(second.unassessedCategories).toEqual(['g1__Privacy', 'g1__Reporting', 'g1__Safety'])
      expect(itemIds(after)).toEqual(['i1', 'i2', 'i3', 'i4'])
    })

    it('skips an earlier suggestion for an item that is no longer in the checklist', async () => {
      const world = await createWorld({ items: THREE_CATEGORIES })
      const first = await world.run()
      world.audit.items = world.audit.items.filter((i) => i.id !== 'i4')
      world.deps.assessBatch = async () => {
        throw new GroqLimitError(7200)
      }

      const second = await world.run({ scope: 'all', capturedInRunId: first.id })

      expect(itemIds(await world.suggestions(second.id))).toEqual(['i1', 'i2', 'i3'])
    })

    it('carries nothing into a failed run', async () => {
      const world = await createWorld({ items: THREE_CATEGORIES })
      const first = await world.run()
      world.deps.browserProvider = async () => {
        throw new Error('no browser')
      }
      // A capture run with no usable page fails.
      world.deps.capture = async () => undefined
      const second = await world.run()

      expect(second.status).toBe('failed')
      expect(await world.suggestions(second.id)).toEqual([])
      expect(itemIds(await world.suggestions(first.id))).toEqual(['i1', 'i2', 'i3', 'i4'])
    })

    it('does not auto-record a decision for a carried suggestion', async () => {
      const world = await createWorld({ items: THREE_CATEGORIES })
      const first = await world.run()
      expect(first.status).toBe('completed')
      world.audit.answers = [answer('i1', 'compliant')]
      world.deps.assessBatch = async () => {
        throw new GroqLimitError(7200)
      }

      await world.run({ scope: 'all', capturedInRunId: first.id })

      expect(await world.repo.listDecisions(PROJECT)).toEqual([])
    })
  })
})
