/**
 * Keeps each repo judge call within MAX_INPUT_TOKENS_PER_CALL, counted with estimateTokens as
 * selectPassages and selectStepPassages do. The pieces that do not fit are neither sent nor stored.
 */
import { estimateTokens } from './assess.js'
import type { PieceDraft } from './repoTypes.js'

/** The entries, in order, that fit together within `maxTokens` after `used`; one that does not fit is skipped. */
export function withinBudget<T>(list: readonly T[], costOf: (entry: T) => number, maxTokens: number, used = 0): T[] {
  const kept: T[] = []
  let total = used
  for (const entry of list) {
    const cost = costOf(entry)
    if (total + cost > maxTokens) continue
    kept.push(entry)
    total += cost
  }
  return kept
}

/**
 * The draft cut down until its passage text fits `maxTokens`: lines dropped from the end (the end
 * line with them), then a lone line cut by characters. A draft that fits is returned as it is.
 * Cannot happen with the search's per-piece character cap; it guards the budget all the same.
 */
export function cutToFit(draft: PieceDraft, textOf: (d: PieceDraft) => string, maxTokens: number): PieceDraft {
  const fits = (d: PieceDraft) => estimateTokens(textOf(d)) <= maxTokens
  if (fits(draft)) return draft
  let lines = draft.code.split('\n')
  let cut: PieceDraft = draft
  while (lines.length > 1) {
    lines = lines.slice(0, -1)
    cut = { ...draft, endLine: draft.startLine + lines.length - 1, code: lines.join('\n') }
    if (fits(cut)) return cut
  }
  const room = Math.max(0, maxTokens * 4 - (textOf({ ...cut, code: '' }).length))
  return { ...cut, code: cut.code.slice(0, room) }
}
