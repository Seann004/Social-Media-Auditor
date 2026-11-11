import { describe, expect, it } from 'vitest'
import { provenance, responseAction, suggestionState, toAnswerStatus } from './state'
import type { DecisionView, SuggestedResult } from './types'

const suggestion = (id: string, suggestedResult: SuggestedResult | null) => ({ id, suggestedResult })

const decision = (over: Partial<DecisionView> = {}): DecisionView => ({
  id: 'd1',
  suggestionId: 's1',
  itemId: 'i1',
  userId: 'u1',
  decision: 'accepted',
  finalResult: 'compliant',
  overrideReason: null,
  origin: 'card',
  decidedAt: '2026-11-04T00:00:00Z',
  suggestedResult: 'yes',
  ...over,
})

describe('toAnswerStatus', () => {
  it('maps the AI results to answer statuses', () => {
    expect(toAnswerStatus('yes')).toBe('compliant')
    expect(toAnswerStatus('no')).toBe('non_compliant')
    expect(toAnswerStatus('partially')).toBe('partially')
    expect(toAnswerStatus('not_applicable')).toBe('not_applicable')
  })
})

describe('suggestionState', () => {
  it('no_suggestion when there is no suggestion, or suggestedResult is null', () => {
    expect(suggestionState({ suggestion: null, decision: null, currentStatus: undefined })).toBe('no_suggestion')
    expect(suggestionState({ suggestion: suggestion('s1', null), decision: null, currentStatus: 'compliant' })).toBe('no_suggestion')
  })

  it('pending with no answer and no decision; needs_review and not_started count as no answer', () => {
    for (const currentStatus of [undefined, 'needs_review', 'not_started'] as const) {
      expect(suggestionState({ suggestion: suggestion('s1', 'yes'), decision: null, currentStatus })).toBe('pending')
    }
  })

  it('agrees / disagrees compare the AI result with the current answer', () => {
    const s = suggestion('s1', 'yes')
    expect(suggestionState({ suggestion: s, decision: null, currentStatus: 'compliant' })).toBe('agrees')
    expect(suggestionState({ suggestion: s, decision: null, currentStatus: 'non_compliant' })).toBe('disagrees')
  })

  it('accepted / overridden when the decision belongs to this suggestion', () => {
    const s = suggestion('s1', 'yes')
    expect(suggestionState({ suggestion: s, decision: decision(), currentStatus: 'compliant' })).toBe('accepted')
    const overridden = decision({ decision: 'overridden', finalResult: 'partially', overrideReason: 'x' })
    expect(suggestionState({ suggestion: s, decision: overridden, currentStatus: 'partially' })).toBe('overridden')
  })

  it('a decision on this suggestion stops counting once the answer is changed by hand (Flag, another answer)', () => {
    const s = suggestion('s1', 'yes')
    expect(suggestionState({ suggestion: s, decision: decision(), currentStatus: 'needs_review' })).toBe('pending')
    expect(suggestionState({ suggestion: s, decision: decision(), currentStatus: 'not_started' })).toBe('pending')
    expect(suggestionState({ suggestion: s, decision: decision(), currentStatus: 'non_compliant' })).toBe('disagrees')
    const overridden = decision({ decision: 'overridden', finalResult: 'partially', overrideReason: 'x' })
    expect(suggestionState({ suggestion: s, decision: overridden, currentStatus: 'needs_review' })).toBe('pending')
    expect(suggestionState({ suggestion: s, decision: overridden, currentStatus: 'compliant' })).toBe('agrees')
  })

  it('new_differs when the decision is from an older run and the new result differs', () => {
    const s = suggestion('s2', 'no')
    expect(suggestionState({ suggestion: s, decision: decision(), currentStatus: 'compliant' })).toBe('new_differs')
  })

  it('agrees when the decision is from an older run and the new result matches', () => {
    const s = suggestion('s2', 'yes')
    expect(suggestionState({ suggestion: s, decision: decision(), currentStatus: 'compliant' })).toBe('agrees')
  })
})

describe('responseAction', () => {
  const s = suggestion('s1', 'yes')

  it('needs_review always saves normally', () => {
    expect(responseAction({ suggestion: s, decision: null, currentStatus: 'compliant', clicked: 'needs_review' })).toEqual({ action: 'save' })
  })

  it('saves when there is no suggestion and no decision', () => {
    expect(responseAction({ suggestion: null, decision: null, currentStatus: undefined, clicked: 'compliant' })).toEqual({ action: 'save' })
    expect(responseAction({ suggestion: suggestion('s1', null), decision: null, currentStatus: undefined, clicked: 'compliant' })).toEqual({ action: 'save' })
  })

  it('saves when clicking the answer already chosen', () => {
    expect(responseAction({ suggestion: s, decision: decision(), currentStatus: 'compliant', clicked: 'compliant' })).toEqual({ action: 'save' })
  })

  it('accepts when clicking the AI result', () => {
    expect(responseAction({ suggestion: s, decision: null, currentStatus: undefined, clicked: 'compliant' })).toEqual({ action: 'accept', suggestionId: 's1' })
    expect(responseAction({ suggestion: s, decision: null, currentStatus: 'non_compliant', clicked: 'compliant' })).toEqual({ action: 'accept', suggestionId: 's1' })
  })

  it('accepts, never asks, when going back to the AI result after an override', () => {
    const earlier = decision({ decision: 'overridden', finalResult: 'partially', overrideReason: 'r' })
    expect(responseAction({ suggestion: s, decision: earlier, currentStatus: 'partially', clicked: 'compliant' })).toEqual({ action: 'accept', suggestionId: 's1' })
  })

  it('asks for a reason when clicking something else, with or without an earlier decision', () => {
    expect(responseAction({ suggestion: s, decision: null, currentStatus: undefined, clicked: 'partially' })).toEqual({ action: 'ask_reason', suggestionId: 's1' })
    expect(responseAction({ suggestion: s, decision: decision(), currentStatus: 'compliant', clicked: 'non_compliant' })).toEqual({ action: 'ask_reason', suggestionId: 's1' })
  })

  it('a null suggestion with an older decision still asks, against the older suggestion', () => {
    const older = decision({ suggestionId: 's0' })
    expect(responseAction({ suggestion: null, decision: older, currentStatus: 'compliant', clicked: 'non_compliant' })).toEqual({ action: 'ask_reason', suggestionId: 's0' })
    expect(responseAction({ suggestion: suggestion('s1', null), decision: older, currentStatus: 'compliant', clicked: 'non_compliant' })).toEqual({ action: 'ask_reason', suggestionId: 's0' })
  })

  it('a null suggestion with an older decision accepts the older suggestion own result, never an override to it', () => {
    const older = decision({ suggestionId: 's0', suggestedResult: 'yes', decision: 'overridden', finalResult: 'partially', overrideReason: 'r' })
    expect(responseAction({ suggestion: null, decision: older, currentStatus: 'partially', clicked: 'compliant' })).toEqual({ action: 'accept', suggestionId: 's0' })
  })

  it('does not mutate its inputs', () => {
    const input = { suggestion: { ...s }, decision: decision(), currentStatus: 'compliant' as const, clicked: 'partially' as const }
    const copy = structuredClone(input)
    responseAction(input)
    expect(input).toEqual(copy)
  })
})

describe('provenance', () => {
  it('is manual when no decision exists, or the answer no longer equals the decision', () => {
    expect(provenance({ decision: null, currentStatus: 'compliant' })).toEqual({ kind: 'manual' })
    expect(provenance({ decision: decision(), currentStatus: 'non_compliant' })).toEqual({ kind: 'manual' })
    expect(provenance({ decision: decision(), currentStatus: undefined })).toEqual({ kind: 'manual' })
  })

  it('is accepted, carrying the suggested result', () => {
    expect(provenance({ decision: decision(), currentStatus: 'compliant' })).toEqual({ kind: 'accepted', suggested: 'yes' })
  })

  it('is overridden, carrying suggested, final and reason', () => {
    const d = decision({ decision: 'overridden', finalResult: 'partially', overrideReason: 'Policy is in a PDF' })
    expect(provenance({ decision: d, currentStatus: 'partially' })).toEqual({
      kind: 'overridden',
      suggested: 'yes',
      final: 'partially',
      reason: 'Policy is in a PDF',
    })
  })
})
