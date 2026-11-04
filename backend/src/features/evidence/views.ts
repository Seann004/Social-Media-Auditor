import type { EvidenceRepository } from './repository.js'
import { latestDecisionPerItem } from './decisions.js'
import { categoryNameOf } from './runnerShared.js'
import type { AccessStatus, AnswerStatus, CapturedPage, Decision, EvidenceRun, Suggestion, SuggestedResult } from './types.js'

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

export function toPageView(page: CapturedPage): PageView {
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

export function toSuggestionView(suggestion: Suggestion, pages: Map<string, CapturedPage>): SuggestionView {
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

export function toDecisionView(decision: Decision, suggestion: Suggestion): DecisionView {
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
    suggestedResult: suggestion.suggestedResult,
  }
}

/** The latest decision for each item. One whose suggestion cannot be found is left out. */
export async function latestDecisionViews(repo: EvidenceRepository, projectId: string): Promise<DecisionView[]> {
  const latest = [...latestDecisionPerItem(await repo.listDecisions(projectId)).values()]
  const views: DecisionView[] = []
  for (const decision of latest) {
    const suggestion = await repo.getSuggestion(decision.suggestionId)
    if (suggestion) views.push(toDecisionView(decision, suggestion))
  }
  return views
}
