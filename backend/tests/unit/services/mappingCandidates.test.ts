import { describe, expect, it } from 'vitest'
import { pickCandidates } from '../../../src/services/mappingCandidates.js'

const s = (id: string, score: number) => ({ id, score })

describe('pickCandidates', () => {
  it('is the lexical list, best first, when there is no semantic list', () => {
    expect(pickCandidates([s('a', 0.2), s('b', 0.9), s('c', 0.5)], null, 2)).toEqual(['b', 'c'])
  })

  it('puts an item both lists rank well first', () => {
    expect(pickCandidates([s('a', 0.9), s('b', 0.8)], [s('b', 0.9), s('c', 0.8)], 3)[0]).toBe('b')
  })

  it('lets in an item that only the semantic list found', () => {
    expect(pickCandidates([s('a', 0.9)], [s('z', 0.9)], 2).sort()).toEqual(['a', 'z'])
  })

  it('respects the limit and returns nothing for empty lists', () => {
    expect(pickCandidates([s('a', 1), s('b', 1), s('c', 1)], [], 2)).toHaveLength(2)
    expect(pickCandidates([], [], 5)).toEqual([])
  })

  it('gives the meaning list slots even when many words hits score higher', () => {
    const lexical = Array.from({ length: 10 }, (_, i) => s(`l${i}`, 1 - i / 100))
    const semantic = [s('m0', 0.95), s('m1', 0.9), s('m2', 0.85)]
    const picked = pickCandidates(lexical, semantic, 5)
    expect(picked).toEqual(['m0', 'l0', 'm1', 'l1', 'm2'])
  })

  it('does not repeat an item both lists found', () => {
    expect(pickCandidates([s('a', 1), s('b', 0.9)], [s('a', 1), s('c', 0.9)], 4)).toEqual(['a', 'c', 'b'])
  })
})
