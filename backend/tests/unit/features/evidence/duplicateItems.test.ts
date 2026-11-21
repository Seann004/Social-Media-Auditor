import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorld, DEFAULT_ITEMS, item, okPage, quoteFirstPassage } from '../../../fixtures/runnerWorld.js'
import { dropTwins, planDuplicates } from '../../../../src/features/evidence/duplicateItems.js'
import { planCategories } from '../../../../src/features/evidence/runPlan.js'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('planDuplicates', () => {
  it('keeps the first item of each group and makes the others its twins', () => {
    const plan = planDuplicates(DEFAULT_ITEMS, [['i3', 'i1']])
    expect(plan.twinsOf.get('i1')?.map((i) => i.id)).toEqual(['i3'])
    expect([...plan.twinIds]).toEqual(['i3'])
  })

  it('ignores groups with fewer than two items on this checklist', () => {
    const plan = planDuplicates(DEFAULT_ITEMS, [['i1', 'not-on-this-checklist']])
    expect(plan.twinIds.size).toBe(0)
  })

  it('handles several groups and a group of three', () => {
    const items = [item('a', 'C', 'x'), item('b', 'C', 'x'), item('c', 'D', 'x'), item('d', 'D', 'y'), item('e', 'D', 'y')]
    const plan = planDuplicates(items, [['a', 'b', 'c'], ['d', 'e']])
    expect(plan.twinsOf.get('a')?.map((i) => i.id)).toEqual(['b', 'c'])
    expect(plan.twinsOf.get('d')?.map((i) => i.id)).toEqual(['e'])
  })
})

describe('dropTwins', () => {
  it('removes twins from batches and drops categories left empty', () => {
    const kept = dropTwins(planCategories(DEFAULT_ITEMS), new Set(['i3']))
    expect(kept.map((c) => c.key)).toEqual(['g1__Privacy'])
    expect(kept[0].batches.flat().map((i) => i.id)).toEqual(['i1', 'i2'])
  })
})

describe('a run with duplicate items', () => {
  async function withGroups(groups: string[][], extra: Parameters<typeof createWorld>[0] = {}) {
    const world = await createWorld({ pages: [okPage()], assess: (input) => quoteFirstPassage(input), ...extra })
    world.audit.listDuplicateGroups = async () => groups
    return world
  }

  it('asks the AI only about the first item and copies its suggestion to the twin', async () => {
    const world = await withGroups([['i1', 'i3']])
    const run = await world.run()
    const asked = world.calls.assess.flatMap((c) => c.items.map((i) => i.id))
    expect(asked).not.toContain('i3')
    expect(asked).toContain('i1')

    const suggestions = await world.suggestions(run.id)
    const primary = suggestions.find((s) => s.itemId === 'i1')!
    const twin = suggestions.find((s) => s.itemId === 'i3')!
    expect(twin.suggestedResult).toBe(primary.suggestedResult)
    expect(twin.reason).toContain(primary.reason)
    expect(twin.reason).toMatch(/same requirement/i)
    expect(twin.quotes.map((q) => q.quoteText)).toEqual(primary.quotes.map((q) => q.quoteText))
    expect(run.status).toBe('completed')
  })

  it('does not count the emptied category of the twin as work to do', async () => {
    const run = await (await withGroups([['i1', 'i3']])).run()
    expect(run.categoriesTotal).toBe(1)
    expect(run.unassessedCategories).toEqual([])
  })

  it('lists the category of the twin as unassessed when the first item got no suggestion', async () => {
    const world = await withGroups([['i1', 'i3']], { assess: (input) => ({ results: [], missingItemIds: input.items.map((i) => i.id), tokensUsed: 10 }) })
    const run = await world.run()
    const suggestions = await world.suggestions(run.id)
    expect(suggestions.some((s) => s.itemId === 'i3')).toBe(false)
    expect(run.status).toBe('partial')
    expect(run.unassessedCategories).toEqual(expect.arrayContaining(['g1__Privacy', 'g1__Reporting']))
  })

  it('assesses everything normally when the groups cannot be read', async () => {
    const world = await createWorld({ pages: [okPage()], assess: (input) => quoteFirstPassage(input) })
    world.audit.listDuplicateGroups = async () => {
      throw new Error('db down')
    }
    const run = await world.run()
    expect(world.calls.assess.flatMap((c) => c.items.map((i) => i.id))).toContain('i3')
    expect(run.status).toBe('completed')
  })

  it('assesses everything when the audit has no way to list groups', async () => {
    const world = await createWorld({ pages: [okPage()], assess: (input) => quoteFirstPassage(input) })
    await world.run()
    expect(world.calls.assess.flatMap((c) => c.items.map((i) => i.id))).toContain('i3')
  })
})
