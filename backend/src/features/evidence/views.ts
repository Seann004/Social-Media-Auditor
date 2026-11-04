import type { EvidenceRepository } from './repository.js'
import { latestDecisionPerItem } from './decisions.js'
import { categoryNameOf } from './runnerShared.js'
import type { AccessStatus, AnswerStatus, Decision, EvidenceRun, PageSummary, Suggestion, SuggestedResult } from './types.js'

/** A run as the browser sees it: categories by name, never by key. */
export type RunView = Omit<EvidenceRun, 'unassessedCategories'> & { unassessedCategories: string[] }

export interface PageView {
  id: string
  url: string
  finalUrl: string | null
  httpStatus: number | null
  accessStatus: AccessStatus
  accessDetail: string | null
  title: string | null
  hasScreenshot: boolean
  capturedAt: string
}

export interface QuoteView {
  id: string
  pageId: string | null
  quoteText: string
  verified: boolean
  pageUrl: string | null
  pageTitle: string | null
  hasHighlight: boolean
}

export type SuggestionView = Omit<Suggestion, 'quotes' | 'passageIdsSent'> & { quotes: QuoteView[] }

export interface DecisionView {
  id: string
  suggestionId: string
  itemId: string
  userId: string | null
  decision: 'accepted' | 'overridden'
  finalResult: AnswerStatus
  overrideReason: string | null
  origin: Decision['origin']
  decidedAt: string
  suggestedResult: SuggestedResult | null
}

export function toRunView(run: EvidenceRun): RunView {
  const names = [...new Set(run.unassessedCategories.map(categoryNameOf))]
  return { ...run, unassessedCategories: names }
}

export function toPageView(page: PageSummary): PageView {
  return {
    id: page.id,
    url: page.url,
    finalUrl: page.finalUrl,
    httpStatus: page.httpStatus,
    accessStatus: page.accessStatus,
    accessDetail: page.accessDetail,
    title: page.title,
    hasScreenshot: page.screenshotPath !== null,
    capturedAt: page.capturedAt,
  }
}

export function toSuggestionView(suggestion: Suggestion, pages: Map<string, PageSummary>): SuggestionView {
  const { quotes, passageIdsSent: _sent, ...rest } = suggestion
  return {
    ...rest,
    quotes: quotes.map((q) => {
      const page = q.pageId ? pages.get(q.pageId) : undefined
      return {
        id: q.id,
        pageId: q.pageId,
        quoteText: q.quoteText,
        verified: q.verified,
        pageUrl: page ? (page.finalUrl ?? page.url) : null,
        pageTitle: page?.title ?? null,
        hasHighlight: q.highlightScreenshotPath !== null,
      }
    }),
  }
}

export function toDecisionView(decision: Decision, suggestedResult: SuggestedResult | null): DecisionView {
  return {
    id: decision.id,
    suggestionId: decision.suggestionId,
    itemId: decision.itemId,
    userId: decision.userId,
    decision: decision.decision,
    finalResult: decision.finalResult,
    overrideReason: decision.overrideReason,
    origin: decision.origin,
    decidedAt: decision.decidedAt,
    suggestedResult,
  }
}

/**
 * The latest decision for each item. The suggested results come from the suggestions already loaded,
 * and one batched read fetches the rest. A decision whose suggestion cannot be found is left out.
 */
export async function latestDecisionViews(
  repo: EvidenceRepository,
  projectId: string,
  known: readonly Suggestion[],
): Promise<DecisionView[]> {
  const latest = [...latestDecisionPerItem(await repo.listDecisions(projectId)).values()]
  const results = new Map<string, SuggestedResult | null>(known.map((s) => [s.id, s.suggestedResult]))
  const missing = [...new Set(latest.map((d) => d.suggestionId).filter((id) => !results.has(id)))]
  if (missing.length > 0) {
    for (const [id, result] of Object.entries(await repo.getSuggestedResults(missing))) results.set(id, result)
  }
  return latest.flatMap((d) => (results.has(d.suggestionId) ? [toDecisionView(d, results.get(d.suggestionId) ?? null)] : []))
}
