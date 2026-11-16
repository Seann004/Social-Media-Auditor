// When a result card may say "This source can't show this item". Pure: no store, no fetch.
import type { CheckSource } from './kindHints'
import type { ItemKindView, RunSource, SuggestionView } from './types'

export const CANNOT_SHOW_NOTE = "This source can't show this item."

/** Mirrors APP_NO_STEPS_REASON in backend/src/features/evidence/appJudge.ts: the app check recorded no page. */
export const APP_NO_STEPS_REASON = 'The check ended before any page of the app could be recorded.'
/** Mirrors REPO_NO_CODE_TRUNCATED_REASON in backend/src/features/evidence/repoJudge.ts: only part of the repository was read. */
export const REPO_TRUNCATED_REASON =
  'No code in the repository matches this item. Only the first part of the repository was read, because it is larger than the limits.'

const FAILURE_REASONS: readonly string[] = [APP_NO_STEPS_REASON, REPO_TRUNCATED_REASON]

const isCheckSource = (source: RunSource): source is CheckSource => source === 'app' || source === 'repo'

/** A check that stopped at a page, recorded nothing, or read only part of the repository: its card keeps the failure wording. */
function checkFailed(suggestion: SuggestionView): boolean {
  return suggestion.flags.some((flag) => flag.type === 'inaccessible') || FAILURE_REASONS.includes(suggestion.reason.trim())
}

export interface CannotShowInput {
  suggestion: SuggestionView
  /** The AI's kind of the item. The server sends only high-confidence kinds; without one nothing is said. */
  kind?: ItemKindView
  /** The result run listed the item as not checked. */
  unchecked?: boolean
}

/**
 * The AI's reason to show after "This source can't show this item", or null to leave the card as it is.
 * Only for an item the AI is sure is policy or process (`neither`): an App or Code repository suggestion
 * with no result, from a check that did not fail, on an item the run did not leave unchecked. An item the
 * AI places with the other source gets no note: that stays advice in the picker, because the AI's app and
 * code calls are not reliable enough to tell an auditor a source cannot show something (it never says
 * "both" with high confidence).
 */
export function cannotShowReason({ suggestion, kind, unchecked = false }: CannotShowInput): string | null {
  if (kind?.kind !== 'neither' || unchecked || suggestion.suggestedResult !== null) return null
  if (!isCheckSource(suggestion.source) || checkFailed(suggestion)) return null
  return kind.reason
}
