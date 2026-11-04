import type { AssessedItem, AssessItem } from './assess.js'
import { selectPassages } from './assess.js'
import { MAX_HIGHLIGHTS_PER_SUGGESTION, MAX_PASSAGES_PER_ITEM } from './config.js'
import { computeFlags } from './flags.js'
import type { NewSuggestion } from './repository.js'
import { isQuoteVerified } from './quotes.js'
import { highlightKey, takeHighlights } from './runnerHighlights.js'
import { abortable, endIfRunGone, type RunCtx } from './runnerShared.js'
import type { AccessStatus, CapturedPage, Passage, Suggestion } from './types.js'

const NO_PASSAGES_REASON = 'No captured page has text that matches this item.'

export interface BatchContext {
  platform: string
  pages: ReadonlyMap<string, CapturedPage>
  failedPages: { url: string; status: AccessStatus }[]
}

export interface BatchOutcome {
  created: Suggestion[]
  tokensUsed: number
  /** Items that were asked about and got no suggestion, so their category must be retried. */
  unassessed: number
}

interface QuoteDraft {
  text: string
  passage: Passage | undefined
  verified: boolean
}

function queryOf(item: AssessItem): string {
  return [item.name, item.text, item.helpText].filter(Boolean).join(' ')
}

function draftQuotes(result: AssessedItem, sent: ReadonlyMap<string, Passage>): QuoteDraft[] {
  return result.quotes.map((q) => {
    // A quote counts only against the passage it names, and only if that passage was sent.
    const passage = q.passageId === null ? undefined : sent.get(q.passageId)
    return { text: q.text, passage, verified: passage !== undefined && isQuoteVerified(q.text, passage.text) }
  })
}

/** Indexes of the quotes that get a close-up: the first few verified ones on page text. */
function highlightCandidates(drafts: QuoteDraft[]): number[] {
  const wanted: number[] = []
  drafts.forEach((d, index) => {
    if (wanted.length < MAX_HIGHLIGHTS_PER_SUGGESTION && d.verified && d.passage?.kind === 'text') wanted.push(index)
  })
  return wanted
}

function collectByPage(drafted: QuoteDraft[][]): Map<string, string[]> {
  const byPage = new Map<string, string[]>()
  for (const drafts of drafted) {
    for (const index of highlightCandidates(drafts)) {
      const { passage, text } = drafts[index]
      const pageId = (passage as Passage).pageId
      const list = byPage.get(pageId) ?? []
      if (!list.includes(text)) byPage.set(pageId, [...list, text])
    }
  }
  return byPage
}

/**
 * Stores a suggestion. If that fails because the item was deleted meanwhile, the item is skipped;
 * any other failure is the batch's. Returns null when the item was skipped.
 */
async function storeSuggestion(ctx: RunCtx, input: NewSuggestion): Promise<Suggestion | null> {
  try {
    return await ctx.deps.repo.addSuggestion(input)
  } catch (err) {
    await endIfRunGone(ctx)
    let items: AssessItem[]
    try {
      items = await ctx.deps.audit.listChecklistItems(ctx.run.projectId)
    } catch {
      throw err
    }
    if (!items.some((i) => i.id === input.itemId)) return null
    throw err
  }
}

function withoutEvidence(ctx: RunCtx, item: AssessItem, batch: BatchContext): NewSuggestion {
  return {
    runId: ctx.run.id,
    projectId: ctx.run.projectId,
    itemId: item.id,
    suggestedResult: null,
    reason: NO_PASSAGES_REASON,
    confidence: 'medium',
    flags: computeFlags({
      suggestedResult: null,
      evidenceSufficient: false,
      conflicting: false,
      webAssessable: true,
      confidence: 'medium',
      aiReason: NO_PASSAGES_REASON,
      passagesFound: 0,
      quotes: [],
      failedPages: batch.failedPages,
    }),
    quotes: [],
  }
}

/**
 * One batch: passages for each item, the AI, the quote check, the close-ups, the flags, and only
 * then the suggestion rows, so that a quote row is never edited afterwards. Throws when the batch
 * as a whole failed; the caller decides what that means for the run.
 */
export async function assessAndStore(ctx: RunCtx, items: AssessItem[], batch: BatchContext): Promise<BatchOutcome> {
  const { repo, assessBatch } = ctx.deps
  const perItem: Passage[][] = []
  for (const item of items) {
    perItem.push(await repo.searchPassages(ctx.run.capturedInRunId, queryOf(item), MAX_PASSAGES_PER_ITEM))
  }
  const selected = selectPassages(perItem)
  const sent = new Map(selected.map((p) => [p.id, p]))
  const found = perItem.map((list) => list.filter((p) => sent.has(p.id)).length)

  const askItems = items.filter((_, i) => found[i] > 0)
  const output =
    askItems.length === 0
      ? { results: [] as AssessedItem[], missingItemIds: [] as string[], tokensUsed: 0 }
      : await abortable(
          assessBatch({ items: askItems, passages: selected, platform: batch.platform, apiKey: ctx.deps.apiKey, model: ctx.deps.model }),
          ctx.signal,
        )

  const drafted = output.results.map((r) => draftQuotes(r, sent))
  const paths = await takeHighlights(ctx, batch.pages, collectByPage(drafted))

  const created: Suggestion[] = []
  for (const item of items.filter((_, i) => found[i] === 0)) {
    const stored = await storeSuggestion(ctx, withoutEvidence(ctx, item, batch))
    if (stored) created.push(stored)
  }
  for (const [index, result] of output.results.entries()) {
    const drafts = drafted[index]
    const candidates = new Set(highlightCandidates(drafts))
    const quotes = drafts.map((d, i) => ({
      passageId: d.passage?.id ?? null,
      pageId: d.passage?.pageId ?? null,
      quoteText: d.text,
      verified: d.verified,
      highlightScreenshotPath:
        candidates.has(i) && d.passage ? (paths.get(highlightKey(d.passage.pageId, d.text)) ?? null) : null,
    }))
    const position = items.findIndex((it) => it.id === result.itemId)
    const stored = await storeSuggestion(ctx, {
      runId: ctx.run.id,
      projectId: ctx.run.projectId,
      itemId: result.itemId,
      suggestedResult: result.suggestedResult,
      reason: result.reason,
      confidence: result.confidence,
      flags: computeFlags({
        suggestedResult: result.suggestedResult,
        evidenceSufficient: result.evidenceSufficient,
        conflicting: result.conflicting,
        webAssessable: result.webAssessable,
        confidence: result.confidence,
        aiReason: result.reason,
        passagesFound: found[position] ?? 0,
        quotes: drafts.map((d) => ({ text: d.text, verified: d.verified })),
        failedPages: batch.failedPages,
      }),
      quotes,
    })
    if (stored) created.push(stored)
  }

  const answered = new Set(output.results.map((r) => r.itemId))
  const unassessed = askItems.filter((it) => !answered.has(it.id)).length
  return { created, tokensUsed: output.tokensUsed, unassessed }
}
