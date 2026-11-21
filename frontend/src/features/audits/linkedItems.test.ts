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
