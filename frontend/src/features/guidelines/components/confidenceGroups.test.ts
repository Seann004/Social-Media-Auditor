import { describe, expect, it } from 'vitest'
import { confidenceLevel, groupByConfidence } from './confidenceGroups'

describe('confidenceLevel', () => {
  it('puts 80% and above in high, 50% to 79% in medium, the rest in low', () => {
    expect(confidenceLevel(1)).toBe('high')
    expect(confidenceLevel(0.8)).toBe('high')
    expect(confidenceLevel(0.79)).toBe('medium')
    expect(confidenceLevel(0.5)).toBe('medium')
    expect(confidenceLevel(0.49)).toBe('low')
    expect(confidenceLevel(0)).toBe('low')
  })

  it('treats a missing or broken score as low', () => {
    expect(confidenceLevel(null)).toBe('low')
    expect(confidenceLevel(Number.NaN)).toBe('low')
  })
})

describe('groupByConfidence', () => {
  const pairs = [
    { id: 'a', confidence: 0.55 },
    { id: 'b', confidence: 0.95 },
    { id: 'c', confidence: null },
    { id: 'd', confidence: 0.85 },
    { id: 'e', confidence: 0.2 },
    { id: 'f', confidence: 0.7 },
  ]

  it('splits the pairs into three sections, most confident first inside each', () => {
    const g = groupByConfidence(pairs)
    expect(g.high.map((p) => p.id)).toEqual(['b', 'd'])
    expect(g.medium.map((p) => p.id)).toEqual(['f', 'a'])
    expect(g.low.map((p) => p.id)).toEqual(['e', 'c'])
  })

  it('does not change the list it was given', () => {
    const copy = pairs.map((p) => ({ ...p }))
    groupByConfidence(pairs)
    expect(pairs).toEqual(copy)
  })

  it('returns three empty sections for no pairs', () => {
    expect(groupByConfidence([])).toEqual({ high: [], medium: [], low: [] })
  })
})
