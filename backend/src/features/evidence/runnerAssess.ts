import type { RunSource, StoppedBy } from './appTypes.js'
import type { AssessedItem, AssessItem } from './assess.js'
import { selectPassages } from './assess.js'
import { MAX_HIGHLIGHTS_PER_SUGGESTION, MAX_PASSAGES_PER_ITEM, MAX_TOKENS_PER_RUN } from './config.js'
import { computeFlags } from './flags.js'
import type { NewSuggestion } from './repository.js'
import { isQuoteVerified } from './quotes.js'
import { highlightKey, takeHighlights } from './runnerHighlights.js'
import { abortable, endIfRunGone, logRunProblem, type RunCtx } from './runnerShared.js'
import type { AccessStatus, CapturedPage, Passage, Suggestion } from './types.js'

const NO_PASSAGES_REASON = 'No captured page has text that matches this item.'

export interface BatchContext {
  platform: string
  pages: ReadonlyMap<string, CapturedPage>
  failedPages: { url: string; status: AccessStatus }[]
  /** Stored on each suggestion. Defaults to 'pages'. */
  source?: RunSource
  /** The page that ended each item's app check, by item id. */
  stoppedBy?: ReadonlyMap<string, StoppedBy>
}

/**
 * Takes the close-ups of the given quotes, by page id. Resolves with the storage path of each quote
 * that has one, keyed by highlightKey; a quote left out shows its page's full screenshot.
 */
export type Highlighter = (quotesByPage: ReadonlyMap<string, string[]>) => Promise<Map<string, string>>

/** The tokens the run has used. A call is counted as soon as the AI has answered it. */
export interface TokenMeter {
  used(): number
  add(tokens: number): void
}

export interface BatchOutcome {
  created: Suggestion[]
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

function draftQuotes(result: AssessedItem, sent: ReadonlyMap<string, Passage>, round: Round): QuoteDraft[] {
  return result.quotes.map((q) => {
    // A quote counts only against the passage it names, and only if that passage was sent.
    const passage = q.passageId === null ? undefined : sent.get(q.passageId)
    const verified = passage !== undefined && isQuoteVerified(q.text, passage.text) && !(round.isUnproven?.(q.text, passage) ?? false)
    return { text: q.text, passage, verified }
  })
}

/** Indexes of the quotes that get a close-up: the first few verified ones on page text. */
function highlightCandidates(drafts: QuoteDraft[], round: Round): number[] {
  const wanted: number[] = []
  drafts.forEach((d, index) => {
    const onPageText = d.passage?.kind === 'text' && (round.takesCloseUp?.(d.passage) ?? true)
    if (wanted.length < MAX_HIGHLIGHTS_PER_SUGGESTION && d.verified && onPageText) wanted.push(index)
  })
  return wanted
}

function collectByPage(drafted: QuoteDraft[][], round: Round): Map<string, string[]> {
  const byPage = new Map<string, string[]>()
  for (const drafts of drafted) {
    for (const index of highlightCandidates(drafts, round)) {
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
export async function storeSuggestion(ctx: RunCtx, input: NewSuggestion): Promise<Suggestion | null> {
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

/** A null suggestion for an item with nothing to send the AI, with the batch's source and the item's stoppedBy. */
export function withoutEvidence(ctx: RunCtx, item: AssessItem, batch: BatchContext, reason: string = NO_PASSAGES_REASON): NewSuggestion {
  return {
    runId: ctx.run.id,
    projectId: ctx.run.projectId,
    itemId: item.id,
    suggestedResult: null,
    reason,
    confidence: 'medium',
    flags: computeFlags({
      suggestedResult: null,
      evidenceSufficient: false,
      conflicting: false,
      webAssessable: true,
      confidence: 'medium',
      aiReason: reason,
      passagesFound: 0,
      quotes: [],
      failedPages: batch.failedPages,
      source: batch.source,
      stoppedBy: batch.stoppedBy?.get(item.id) ?? null,
    }),
    passageIdsSent: [],
    source: batch.source,
    quotes: [],
  }
}

export interface Round {
  selected: Passage[]
  /** How many passages of each asked item went in the call. */
  found: Map<string, number>
  results: AssessedItem[]
  /** For app checks: a quote this names is unverified whatever its passage says (ruling A20b). */
  isUnproven?: (quote: string, passage: Passage) => boolean
  /** Whether quotes of a page-text passage may get a close-up. Defaults to all of them. */
  takesCloseUp?: (passage: Passage) => boolean
}

async function closeUps(ctx: RunCtx, highlighter: Highlighter | null, quotesByPage: Map<string, string[]>): Promise<Map<string, string>> {
  if (highlighter === null || quotesByPage.size === 0) return new Map()
  try {
    return await highlighter(quotesByPage)
  } catch (err) {
    // A close-up is a picture for people: without one, the card shows the page's full screenshot.
    logRunProblem(ctx, 'Could not take the close-ups', err)
    return new Map()
  }
}

/**
 * Quote check, close-ups, flags, then the rows, so that a quote row is never edited afterwards.
 * A null highlighter takes no close-ups and opens no browser.
 */
export async function storeRound(ctx: RunCtx, round: Round, batch: BatchContext, highlighter: Highlighter | null): Promise<Suggestion[]> {
  const sent = new Map(round.selected.map((p) => [p.id, p]))
  const passageIdsSent = round.selected.map((p) => p.id)
  const drafted = round.results.map((r) => draftQuotes(r, sent, round))
  const paths = await closeUps(ctx, highlighter, collectByPage(drafted, round))

  const created: Suggestion[] = []
  for (const [index, result] of round.results.entries()) {
    const drafts = drafted[index]
    const candidates = new Set(highlightCandidates(drafts, round))
    const quotes = drafts.map((d, i) => ({
      passageId: d.passage?.id ?? null,
      pageId: d.passage?.pageId ?? null,
      quoteText: d.text,
      verified: d.verified,
      highlightScreenshotPath:
        candidates.has(i) && d.passage ? (paths.get(highlightKey(d.passage.pageId, d.text)) ?? null) : null,
    }))
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
        passagesFound: round.found.get(result.itemId) ?? 0,
        quotes: drafts.map((d) => ({ text: d.text, verified: d.verified })),
        failedPages: batch.failedPages,
        source: batch.source,
        stoppedBy: batch.stoppedBy?.get(result.itemId) ?? null,
      }),
      passageIdsSent,
      source: batch.source,
      quotes,
    })
    if (stored) created.push(stored)
  }
  return created
}

/**
 * One batch: passages for each item, the AI, the quote check, the close-ups, the flags, and only
 * then the suggestion rows. Items with search hits whose passages did not fit the call budget get
 * a further call (never the no-text sentence), as long as the run has tokens left and each call
 * can carry at least one of them. Throws when the batch as a whole failed; the caller decides what
 * that means for the run.
 */
export async function assessAndStore(ctx: RunCtx, items: AssessItem[], batch: BatchContext, meter: TokenMeter): Promise<BatchOutcome> {
  const { repo, assessBatch } = ctx.deps
  const hits = new Map<string, Passage[]>()
  for (const item of items) {
    hits.set(item.id, await repo.searchPassages(ctx.run.capturedInRunId, queryOf(item), MAX_PASSAGES_PER_ITEM))
  }

  const created: Suggestion[] = []
  for (const item of items.filter((it) => (hits.get(it.id) ?? []).length === 0)) {
    const stored = await storeSuggestion(ctx, withoutEvidence(ctx, item, batch))
    if (stored) created.push(stored)
  }

  let remaining = items.filter((it) => (hits.get(it.id) ?? []).length > 0)
  let unassessed = 0
  while (remaining.length > 0) {
    if (meter.used() >= MAX_TOKENS_PER_RUN) break
    const selected = selectPassages(remaining.map((it) => hits.get(it.id) as Passage[]))
    const sentIds = new Set(selected.map((p) => p.id))
    const found = new Map(remaining.map((it) => [it.id, (hits.get(it.id) as Passage[]).filter((p) => sentIds.has(p.id)).length]))
    const asked = remaining.filter((it) => (found.get(it.id) ?? 0) > 0)
    // Cannot happen while a passage always fits a call; stops a loop that would make no progress.
    if (asked.length === 0) break

    const output = await abortable(
      assessBatch({ items: asked, passages: selected, platform: batch.platform, apiKey: ctx.deps.apiKey, model: ctx.deps.model }),
      ctx.signal,
    )
    meter.add(output.tokensUsed)
    const highlighter: Highlighter = (quotes) => takeHighlights(ctx, batch.pages, quotes)
    created.push(...(await storeRound(ctx, { selected, found, results: output.results }, batch, highlighter)))

    const answered = new Set(output.results.map((r) => r.itemId))
    unassessed += asked.filter((it) => !answered.has(it.id)).length
    const askedIds = new Set(asked.map((it) => it.id))
    remaining = remaining.filter((it) => !askedIds.has(it.id))
  }
  return { created, unassessed: unassessed + remaining.length }
}
