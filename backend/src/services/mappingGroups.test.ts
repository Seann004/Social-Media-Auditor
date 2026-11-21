import { describe, expect, it } from 'vitest'
import { buildGroups, derivedPairs, groupIndex, type GroupEdge } from './mappingGroups.js'

const eq = (a: string, b: string): GroupEdge => ({ itemIdA: a, itemIdB: b, relation: 'equivalent' })
const part = (a: string, b: string): GroupEdge => ({ itemIdA: a, itemIdB: b, relation: 'partial' })

describe('buildGroups', () => {
  it('joins items linked through a shared item', () => {
    expect(buildGroups([eq('a', 'b'), eq('a', 'c')])).toEqual([['a', 'b', 'c']])
  })

  it('joins a chain, whichever way the links point', () => {
    expect(buildGroups([eq('a', 'b'), eq('c', 'b'), eq('d', 'c')])).toEqual([['a', 'b', 'c', 'd']])
  })

  it('keeps separate groups apart and lists the largest first', () => {
    expect(buildGroups([eq('x', 'y'), eq('a', 'b'), eq('b', 'c')])).toEqual([['a', 'b', 'c'], ['x', 'y']])
  })

  it('does not let a partly-overlapping link join items', () => {
    expect(buildGroups([eq('a', 'b'), part('b', 'c')])).toEqual([['a', 'b']])
    expect(buildGroups([part('a', 'b')])).toEqual([])
  })

  it('ignores letter case in ids', () => {
    expect(buildGroups([eq('A1', 'b1'), eq('a1', 'C1')])).toEqual([['a1', 'b1', 'c1']])
  })

  it('returns nothing for no links', () => {
    expect(buildGroups([])).toEqual([])
  })
})

describe('groupIndex', () => {
  it('finds the group of an item, and nothing for an item with no group', () => {
    const index = groupIndex([eq('a', 'b'), eq('b', 'c')])
    expect(index.get('c')).toEqual(['a', 'b', 'c'])
    expect(index.get('z')).toBeUndefined()
  })
})

describe('derivedPairs', () => {
  it('adds the pair no admin linked directly', () => {
    expect(derivedPairs([eq('a', 'b'), eq('a', 'c')]).map((p) => [p.itemIdA, p.itemIdB])).toEqual([['b', 'c']])
  })

  it('adds every missing pair of a longer chain', () => {
    expect(derivedPairs([eq('a', 'b'), eq('b', 'c'), eq('c', 'd')]).map((p) => `${p.itemIdA}${p.itemIdB}`).sort()).toEqual(['ac', 'ad', 'bd'])
  })

  it('adds nothing when every pair is already linked', () => {
    expect(derivedPairs([eq('a', 'b'), eq('b', 'c'), eq('a', 'c')])).toEqual([])
  })

  it('limits the pairs to the items that matter, even when the link between them is outside', () => {
    expect(derivedPairs([eq('a', 'b'), eq('a', 'c')], new Set(['b', 'c'])).map((p) => [p.itemIdA, p.itemIdB])).toEqual([['b', 'c']])
    expect(derivedPairs([eq('a', 'b'), eq('a', 'c')], new Set(['b']))).toEqual([])
  })
})
