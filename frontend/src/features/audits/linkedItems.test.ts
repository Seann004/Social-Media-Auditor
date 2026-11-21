import { describe, expect, it } from 'vitest'
import type { MappedItem, SimilarPair } from '../../lib/db'
import { linkedItemsByItem } from './linkedItems'

const side = (guidelineName: string, itemCode: string | null, text: string): MappedItem =>
  ({ itemId: 'x', guidelineId: 'g', guidelineName, category: 'Age', itemCode, text, reference: null, clause: null })

const pair = (a: string, b: string, relation: 'equivalent' | 'partial', itemA: MappedItem, itemB: MappedItem): SimilarPair =>
  ({ mappingId: `${a}${b}`, relation, confidence: 0.9, rationale: null, projectItemIdA: a, projectItemIdB: b, itemA, itemB })

describe('linkedItemsByItem', () => {
  it('lists each pair on both items, pointing at the other', () => {
    const out = linkedItemsByItem([pair('a1', 'b1', 'equivalent', side('TESTA', 'A-1', 'one'), side('TESTB', 'B-1', 'two'))])
    expect(out.a1).toEqual([{ itemId: 'b1', relation: 'equivalent', guidelineName: 'TESTB', label: 'B-1' }])
    expect(out.b1).toEqual([{ itemId: 'a1', relation: 'equivalent', guidelineName: 'TESTA', label: 'A-1' }])
  })

  it('keeps every link of an item with several, and shortens text when there is no code', () => {
    const long = 'Age is verified at sign-up and again before sensitive features'
    const out = linkedItemsByItem([
      pair('a1', 'b1', 'equivalent', side('A', 'A-1', 'x'), side('B', 'B-1', 'y')),
      pair('a1', 'c1', 'partial', side('A', 'A-1', 'x'), side('C', null, long)),
    ])
    expect(out.a1.map((l) => l.relation)).toEqual(['equivalent', 'partial'])
    expect(out.a1[1].label.endsWith('…')).toBe(true)
    expect(out.a1[1].label.length).toBeLessThanOrEqual(29)
  })

  it('returns nothing for no pairs', () => {
    expect(linkedItemsByItem([])).toEqual({})
  })
})

import { disagreeingLinks, visibleLinks, type LinkedItem } from './linkedItems'

const link = (itemId: string, relation: 'equivalent' | 'partial' = 'equivalent'): LinkedItem => ({ itemId, relation, guidelineName: 'G', label: itemId })

describe('visibleLinks', () => {
  it('shows every link when there are two or fewer', () => {
    expect(visibleLinks([1, 2], false)).toEqual({ shown: [1, 2], hidden: 0 })
  })

  it('shows the first two and counts the rest when there are more', () => {
    expect(visibleLinks([1, 2, 3, 4], false)).toEqual({ shown: [1, 2], hidden: 2 })
  })

  it('shows all of them once expanded', () => {
    expect(visibleLinks([1, 2, 3, 4], true)).toEqual({ shown: [1, 2, 3, 4], hidden: 0 })
  })
})

describe('disagreeingLinks', () => {
  const answers: Record<string, string> = { b: 'compliant', c: 'non_compliant' }
  const of = (id: string) => answers[id]

  it('returns the linked items that answered differently from this one', () => {
    expect(disagreeingLinks([link('b'), link('c')], 'compliant', of).map((l) => l.itemId)).toEqual(['c'])
  })

  it('returns nothing when everyone agrees', () => {
    expect(disagreeingLinks([link('b')], 'compliant', of)).toEqual([])
  })

  it('compares among the linked items when this one is not answered', () => {
    expect(disagreeingLinks([link('b'), link('c')], undefined, of).map((l) => l.itemId)).toEqual(['b', 'c'])
  })

  it('ignores unanswered and flagged items and partly-overlapping links', () => {
    const mixed: Record<string, string> = { b: 'not_started', c: 'needs_review', d: 'non_compliant' }
    expect(disagreeingLinks([link('b'), link('c'), link('d', 'partial')], 'compliant', (id) => mixed[id])).toEqual([])
  })
})
