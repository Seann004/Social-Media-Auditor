import { describe, expect, it } from 'vitest'
import { categoryKey, flaggedCountsByCategory, hasAnswer, isFlagged } from '../../../../src/features/evidence/state'
import { makeSuggestion } from '../../../../src/features/evidence/testFixtures'

const flag = { type: 'missing_evidence', reason: 'x' } as const
const items = [
  { id: 'a', guidelineId: 'g1', category: 'Privacy' },
  { id: 'b', guidelineId: 'g1', category: 'Privacy' },
  { id: 'c', guidelineId: 'g2', category: 'Privacy' },
  { id: 'd', guidelineId: 'g1', category: 'Safety' },
]

describe('isFlagged', () => {
  it('is true when there is at least one flag', () => expect(isFlagged(makeSuggestion({ flags: [flag] }))).toBe(true))
  it('is false without flags', () => expect(isFlagged(makeSuggestion({ flags: [] }))).toBe(false))
  it('is true for a suggestion with no result but a flag', () =>
    expect(isFlagged(makeSuggestion({ suggestedResult: null, flags: [flag] }))).toBe(true))
})

describe('flaggedCountsByCategory', () => {
  it('counts flagged suggestions per guideline and category', () => {
    const counts = flaggedCountsByCategory(
      [
        makeSuggestion({ itemId: 'a', flags: [flag] }),
        makeSuggestion({ itemId: 'b', flags: [flag, flag] }),
        makeSuggestion({ itemId: 'd', flags: [] }),
      ],
      items,
    )
    expect(counts.get(categoryKey('g1', 'Privacy'))).toBe(2)
    expect(counts.has(categoryKey('g1', 'Safety'))).toBe(false)
  })
  it('same category name in two guidelines counts separately', () => {
    const counts = flaggedCountsByCategory(
      [makeSuggestion({ itemId: 'a', flags: [flag] }), makeSuggestion({ itemId: 'c', flags: [flag] })],
      items,
    )
    expect(counts.get(categoryKey('g1', 'Privacy'))).toBe(1)
    expect(counts.get(categoryKey('g2', 'Privacy'))).toBe(1)
  })
  it('ignores a suggestion whose item is unknown', () => {
    expect(flaggedCountsByCategory([makeSuggestion({ itemId: 'zzz', flags: [flag] })], items).size).toBe(0)
  })
})

describe('hasAnswer', () => {
  it.each([
    ['compliant', true], ['non_compliant', true], ['partially', true], ['not_applicable', true],
    ['not_started', false], ['needs_review', false], [undefined, false],
  ] as const)('%s -> %s', (s, expected) => expect(hasAnswer(s)).toBe(expected))
})
