import { describe, it, expect } from 'vitest'
import { toAnswerStatus, type SuggestedResult } from '../../../../src/features/evidence/types.js'

describe('toAnswerStatus', () => {
  it.each([
    ['yes', 'compliant'],
    ['no', 'non_compliant'],
    ['partially', 'partially'],
    ['not_applicable', 'not_applicable'],
  ])('maps %s to %s', (r, s) => {
    expect(toAnswerStatus(r as SuggestedResult)).toBe(s)
  })
})
