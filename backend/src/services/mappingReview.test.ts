import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables, tables } from '../test/fakeSupabase.js'

vi.mock('../config/supabase.js', async () => {
  const fake = await import('../test/fakeSupabase.js')
  return { supabase: fake.supabase }
})

const review = await import('./mappingReview.js')

const guideline = (name: string) => ({ guidelineName: name, shortName: name })

function pair(id: string, a: string, b: string, relation: 'equivalent' | 'partial', confidence: number | null, status = 'suggested', createdAt = '2026-01-01T00:00:00Z') {
  return { mappingId: id, itemIdA: a, itemIdB: b, relation, confidence, rationale: `why ${id}`, status, createdAt, reviewedBy: null, reviewedAt: null }
}

function seed() {
  resetTables({
    Checklist: [
      { checklistId: 'gc1', guidelineId: 'G1', projectId: null, Guideline: guideline('ONSA') },
      { checklistId: 'gc2', guidelineId: 'G2', projectId: null, Guideline: guideline('UKCC') },
      { checklistId: 'gc3', guidelineId: 'G3', projectId: null, Guideline: guideline('EDPB') },
      // Project 1 uses g1a and g2a (together); project 2 uses g1a only; project 3 uses g3a.
      { checklistId: 'p1c1', guidelineId: 'G1', projectId: 'P1' },
      { checklistId: 'p1c2', guidelineId: 'G2', projectId: 'P1' },
      { checklistId: 'p2c1', guidelineId: 'G1', projectId: 'P2' },
      { checklistId: 'p3c3', guidelineId: 'G3', projectId: 'P3' },
    ],
    Checklist_Item: [
      { itemId: 'g1a', checklistId: 'gc1', category: 'Age', itemDescription: 'Age check one' },
      { itemId: 'g1b', checklistId: 'gc1', category: 'Age', itemDescription: 'Data rule one' },
      { itemId: 'g2a', checklistId: 'gc2', category: 'Age', itemDescription: 'Age check two' },
      { itemId: 'g2b', checklistId: 'gc2', category: 'Data', itemDescription: 'Data rule two' },
      { itemId: 'g3a', checklistId: 'gc3', category: 'Age', itemDescription: 'Age check three' },
      { itemId: 'u1', checklistId: 'p1c1', category: 'Age', originalItemId: 'g1a' },
      { itemId: 'u2', checklistId: 'p1c2', category: 'Age', originalItemId: 'g2a' },
      { itemId: 'u3', checklistId: 'p2c1', category: 'Age', originalItemId: 'g1a' },
      { itemId: 'u4', checklistId: 'p3c3', category: 'Age', originalItemId: 'g3a' },
    ],
    Item_Mapping: [],
  })
}

const ids = (page: { items: { mappingId: string }[] }) => page.items.map((i) => i.mappingId)

beforeEach(() => { seed() })

describe('fetchLibraryItemUsage', () => {
  it('lists the projects that use each library item', async () => {
    const usage = await review.fetchLibraryItemUsage()
    expect(Array.from(usage.get('g1a')!).sort()).toEqual(['P1', 'P2'])
    expect(Array.from(usage.get('g2a')!)).toEqual(['P1'])
    expect(usage.has('g1b')).toBe(false)
  })

  it('leaves out items a project switched off and items it added itself', async () => {
    tables.Checklist_Item.find((i) => i.itemId === 'u3')!.category = '__deactivated__Age'
    tables.Checklist_Item.push({ itemId: 'own', checklistId: 'p2c1', category: 'Age', originalItemId: null })
    const usage = await review.fetchLibraryItemUsage()
    expect(Array.from(usage.get('g1a')!)).toEqual(['P1'])
  })
})

describe('listMappings ranking', () => {
  beforeEach(() => {
    tables.Item_Mapping = [
      pair('unused-high', 'g1b', 'g2b', 'equivalent', 0.9),
      pair('together-high', 'g1a', 'g2a', 'equivalent', 0.85),
      pair('mid', 'g1a', 'g3a', 'partial', 0.6),
      pair('low', 'g2a', 'g3a', 'partial', 0.3),
      pair('none', 'g1b', 'g3a', 'partial', null),
    ]
  })

  it('puts the confidence level first, then pairs that matter to more projects, then the score', async () => {
    const page = await review.listMappings({ status: 'suggested' })
    expect(ids(page)).toEqual(['together-high', 'unused-high', 'mid', 'low', 'none'])
  })

  it('reports how many projects use each item and both together', async () => {
    const page = await review.listMappings({ status: 'suggested' })
    const first = page.items[0]
    expect(first.usage).toEqual({ projectsA: 2, projectsB: 1, together: 1 })
    expect(first.itemA.guidelineName).toBe('ONSA')
  })

  it('counts the pairs per level for the whole filtered list', async () => {
    const page = await review.listMappings({ status: 'suggested' })
    expect(page.levels).toEqual({ high: 2, medium: 1, low: 2 })
    expect(page.total).toBe(5)
  })

  it('keeps only pairs whose two items are both used, when asked', async () => {
    const page = await review.listMappings({ status: 'suggested', inUse: true })
    expect(ids(page).sort()).toEqual(['low', 'mid', 'together-high'])
  })

  it('filters by guideline and by relation', async () => {
    expect(ids(await review.listMappings({ status: 'suggested', guidelineId: 'G3' })).sort()).toEqual(['low', 'mid', 'none'])
    expect(ids(await review.listMappings({ status: 'suggested', relation: 'equivalent' }))).toEqual(['together-high', 'unused-high'])
  })

  it('pages through the list without repeating or missing a pair', async () => {
    const first = await review.listMappings({ status: 'suggested' }, 0, 2)
    const second = await review.listMappings({ status: 'suggested' }, 2, 2)
    const third = await review.listMappings({ status: 'suggested' }, 4, 2)
    expect([...ids(first), ...ids(second), ...ids(third)]).toEqual(['together-high', 'unused-high', 'mid', 'low', 'none'])
    expect(first.total).toBe(5)
  })

  it('never returns more than the page limit', async () => {
    const page = await review.listMappings({ status: 'suggested' }, 0, 100000)
    expect(page.items.length).toBeLessThanOrEqual(review.MAX_PAGE_SIZE)
    expect((await review.listMappings({ status: 'suggested' }, 0, 0)).items).toHaveLength(1)
  })

  it('counts pairs per status, with and without the filters', async () => {
    tables.Item_Mapping.push(pair('ok', 'g1a', 'g2b', 'equivalent', 0.9, 'confirmed'), pair('no', 'g1b', 'g2a', 'partial', 0.5, 'rejected'))
    const page = await review.listMappings({ status: 'suggested', relation: 'equivalent' })
    expect(page.counts).toEqual({ suggested: 2, confirmed: 1, rejected: 0 })
    expect(page.totals).toEqual({ suggested: 5, confirmed: 1, rejected: 1 })
  })

  it('shows only the pairs of the chosen status', async () => {
    tables.Item_Mapping.push(pair('ok', 'g1a', 'g2b', 'equivalent', 0.9, 'confirmed'))
    expect(ids(await review.listMappings({ status: 'confirmed' }))).toEqual(['ok'])
  })

  it('lists the guidelines that appear in a pair', async () => {
    const page = await review.listMappings({ status: 'suggested' })
    expect(page.linkedGuidelineIds.sort()).toEqual(['G1', 'G2', 'G3'])
    tables.Item_Mapping = [pair('x', 'g1a', 'g2a', 'equivalent', 0.9)]
    expect((await review.listMappings({ status: 'suggested' })).linkedGuidelineIds.sort()).toEqual(['G1', 'G2'])
  })

  it('leaves out a pair whose item no longer exists', async () => {
    tables.Item_Mapping.push(pair('orphan', 'g1a', 'gone', 'partial', 0.7))
    expect(ids(await review.listMappings({ status: 'suggested' }))).not.toContain('orphan')
  })
})

describe('listMappings learning from past decisions', () => {
  it('lowers the score of a pair when the admin rejected most pairs at that confidence', async () => {
    tables.Item_Mapping = [
      pair('new', 'g1b', 'g2b', 'equivalent', 0.92),
      ...Array.from({ length: 18 }, (_, i) => pair(`bad${i}`, 'g1a', 'g3a', 'equivalent', 0.92, 'rejected')),
      ...Array.from({ length: 2 }, (_, i) => pair(`good${i}`, 'g2a', 'g3a', 'equivalent', 0.92, 'confirmed')),
    ]
    const [first] = (await review.listMappings({ status: 'suggested' })).items
    expect(first.confidence).toBe(0.92)
    expect(first.learnedConfidence).toBe(0.24)
    expect(first.learnedFrom).toBe(20)
    expect(first.level).toBe('low')
  })

  it('keeps the AI score while there are no decisions', async () => {
    tables.Item_Mapping = [pair('new', 'g1b', 'g2b', 'equivalent', 0.92)]
    const [first] = (await review.listMappings({ status: 'suggested' })).items
    expect(first).toMatchObject({ confidence: 0.92, learnedConfidence: 0.92, learnedFrom: 0, level: 'high' })
  })

  it('gives a pair without an AI score no learned score', async () => {
    tables.Item_Mapping = [pair('new', 'g1b', 'g2b', 'partial', null)]
    const [first] = (await review.listMappings({ status: 'suggested' })).items
    expect(first).toMatchObject({ confidence: null, learnedConfidence: null, level: 'low' })
  })

  it('reports how the AI has done so far', async () => {
    tables.Item_Mapping = [
      pair('a', 'g1a', 'g2a', 'equivalent', 0.9, 'confirmed'),
      pair('b', 'g1b', 'g2b', 'equivalent', 0.9, 'rejected'),
      pair('c', 'g1a', 'g3a', 'partial', 0.6),
    ]
    const learning = await review.getLearning()
    expect(learning).toMatchObject({ decided: 2, approved: 1, rejected: 1 })
    expect(learning.bands).toEqual([{ relation: 'equivalent', fromPercent: 90, toPercent: 100, decided: 2, approved: 1, approvalRate: 0.5 }])
  })
})

describe('reviewMappingsByIds', () => {
  beforeEach(() => {
    tables.Item_Mapping = [pair('a', 'g1a', 'g2a', 'equivalent', 0.9), pair('b', 'g1b', 'g2b', 'partial', 0.6), pair('c', 'g1a', 'g3a', 'partial', 0.4)]
  })

  it('decides every listed pair with the reviewer and the time', async () => {
    const result = await review.reviewMappingsByIds(['a', 'b'], 'confirmed', undefined, 'admin-1')
    expect(result).toEqual({ updated: 2 })
    expect(tables.Item_Mapping.map((m) => m.status)).toEqual(['confirmed', 'confirmed', 'suggested'])
    expect(tables.Item_Mapping[0]).toMatchObject({ reviewedBy: 'admin-1', relation: 'equivalent' })
    expect(tables.Item_Mapping[0].reviewedAt).toBeTruthy()
  })

  it('can set the relation for all of them', async () => {
    await review.reviewMappingsByIds(['a', 'b'], 'confirmed', 'partial', 'admin-1')
    expect(tables.Item_Mapping.map((m) => m.relation)).toEqual(['partial', 'partial', 'partial'])
  })

  it('skips ids that do not exist and counts a repeated id once', async () => {
    expect(await review.reviewMappingsByIds(['a', 'a', 'nope'], 'rejected', undefined, 'admin-1')).toEqual({ updated: 1 })
  })

  it('refuses more pairs than one decision may change', async () => {
    const tooMany = Array.from({ length: review.MAX_BULK_PAIRS + 1 }, (_, i) => `id${i}`)
    await expect(review.reviewMappingsByIds(tooMany, 'confirmed', undefined, 'admin-1')).rejects.toThrow(RangeError)
  })
})

describe('reviewMappingsByFilter', () => {
  beforeEach(() => {
    tables.Item_Mapping = [
      pair('h1', 'g1a', 'g2a', 'equivalent', 0.95),
      pair('h2', 'g1b', 'g2b', 'equivalent', 0.9),
      pair('m1', 'g1a', 'g3a', 'partial', 0.6),
    ]
  })

  it('decides everything the filter matches when the count is what the admin saw', async () => {
    const result = await review.reviewMappingsByFilter({ status: 'suggested', level: 'high' }, 2, 'confirmed', undefined, 'admin-1')
    expect(result).toEqual({ updated: 2 })
    expect(tables.Item_Mapping.map((m) => m.status)).toEqual(['confirmed', 'confirmed', 'suggested'])
  })

  it('changes nothing when the list is not the one the admin saw', async () => {
    await expect(review.reviewMappingsByFilter({ status: 'suggested', level: 'high' }, 1, 'confirmed', undefined, 'admin-1'))
      .rejects.toMatchObject({ actual: 2 })
    expect(tables.Item_Mapping.every((m) => m.status === 'suggested')).toBe(true)
  })

  it('does nothing and says so when nothing matches and none was expected', async () => {
    expect(await review.reviewMappingsByFilter({ status: 'suggested', level: 'low' }, 0, 'rejected', undefined, 'admin-1')).toEqual({ updated: 0 })
  })

  it('respects the other filters', async () => {
    const result = await review.reviewMappingsByFilter({ status: 'suggested', relation: 'partial' }, 1, 'rejected', undefined, 'admin-1')
    expect(result).toEqual({ updated: 1 })
    expect(tables.Item_Mapping.find((m) => m.mappingId === 'm1')!.status).toBe('rejected')
  })
})
