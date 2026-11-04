// Pure rules for a suggestion card and the answer buttons (spec 9.4). No store access, no mutation.
import type { ChecklistItemStatus } from '../../types'
import type { AnswerStatus, DecisionView, SuggestedResult } from './types'

export type CardState =
  | 'no_suggestion'
  | 'pending'
  | 'agrees'
  | 'disagrees'
  | 'accepted'
  | 'overridden'
  | 'new_differs'

export type ResponseAction = { action: 'save' | 'accept' | 'ask_reason'; suggestionId?: string }

export type Provenance =
  | { kind: 'manual' }
  | { kind: 'accepted'; suggested: SuggestedResult | null }
  | { kind: 'overridden'; suggested: SuggestedResult | null; final: AnswerStatus; reason: string }

/** Just what the rules need from a suggestion. */
export interface SuggestionRef {
  id: string
  suggestedResult: SuggestedResult | null
}

type CurrentStatus = ChecklistItemStatus | undefined

// Mirrors toAnswerStatus in backend/src/features/evidence/types.ts
const ANSWER_STATUS: Readonly<Record<SuggestedResult, AnswerStatus>> = {
  yes: 'compliant',
  no: 'non_compliant',
  partially: 'partially',
  not_applicable: 'not_applicable',
}

export function toAnswerStatus(result: SuggestedResult): AnswerStatus {
  return ANSWER_STATUS[result]
}

/** The answer buttons' value, or undefined when the item has no answer yet. */
function answerOf(status: CurrentStatus): AnswerStatus | undefined {
  return status === undefined || status === 'needs_review' || status === 'not_started' ? undefined : status
}

export function suggestionState(input: {
  suggestion: SuggestionRef | null
  decision: DecisionView | null
  currentStatus: CurrentStatus
}): CardState {
  const { suggestion, decision } = input
  if (!suggestion || suggestion.suggestedResult === null) return 'no_suggestion'
  if (decision && decision.suggestionId === suggestion.id) return decision.decision
  const answer = answerOf(input.currentStatus)
  if (answer === undefined) return 'pending'
  const matches = answer === toAnswerStatus(suggestion.suggestedResult)
  if (decision) return matches ? 'agrees' : 'new_differs'
  return matches ? 'agrees' : 'disagrees'
}

export function responseAction(input: {
  suggestion: SuggestionRef | null
  decision: DecisionView | null
  currentStatus: CurrentStatus
  clicked: ChecklistItemStatus
}): ResponseAction {
  const { suggestion, decision, clicked } = input
  if (clicked === 'needs_review' || clicked === 'not_started') return { action: 'save' }

  // The suggestion in play: the current one when it has a result, else the one an earlier decision was made on.
  const target: { id: string; result: SuggestedResult | null } | null =
    suggestion && suggestion.suggestedResult !== null
      ? { id: suggestion.id, result: suggestion.suggestedResult }
      : decision
        ? { id: decision.suggestionId, result: decision.suggestedResult }
        : null
  if (!target) return { action: 'save' }

  if (clicked === answerOf(input.currentStatus)) return { action: 'save' }
  // The backend refuses an override to the suggestion's own result (422), so that click is an accept.
  if (target.result !== null && clicked === toAnswerStatus(target.result)) return { action: 'accept', suggestionId: target.id }
  return { action: 'ask_reason', suggestionId: target.id }
}

export function provenance(input: { decision: DecisionView | null; currentStatus: CurrentStatus }): Provenance {
  const { decision } = input
  if (!decision || decision.finalResult !== answerOf(input.currentStatus)) return { kind: 'manual' }
  if (decision.decision === 'accepted') return { kind: 'accepted', suggested: decision.suggestedResult }
  return {
    kind: 'overridden',
    suggested: decision.suggestedResult,
    final: decision.finalResult,
    reason: decision.overrideReason ?? '',
  }
}
