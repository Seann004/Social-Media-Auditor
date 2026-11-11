import type { EvidenceRepository } from './repository.js'
import { latestDecisionPerItem } from './decisions.js'
import type { RepoSuggestionInfo } from './repoSuggestionInfo.js'
import { categoryNameOf } from './runnerShared.js'
import type { AccessStatus, AnswerStatus, Decision, EvidenceRun, PageSummary, Suggestion, SuggestedResult, SuggestionSummary } from './types.js'

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
  /** Whether the quote's page has a screenshot: a code piece never has one, so no picture is asked for. */
  pageHasScreenshot: boolean
}

export type SuggestionView = Omit<Suggestion, 'quotes' | 'passageIdsSent' | 'originSuggestionId'> & {
  quotes: QuoteView[]
  /** For a repo suggestion: the commit its code was read at. Null when unknown or for other sources. */
  commitSha: string | null
  /** For a repo suggestion: whether code pieces were kept or passages sent for it. False for other sources. */
  hasCode: boolean
}

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

export function toSuggestionView(suggestion: Suggestion, pages: Map<string, PageSummary>, repoInfo?: RepoSuggestionInfo): SuggestionView {
  const { quotes, passageIdsSent: _sent, originSuggestionId: _origin, ...rest } = suggestion
  return {
    ...rest,
    commitSha: repoInfo?.commitSha ?? null,
    hasCode: repoInfo?.hasCode ?? false,
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
        pageHasScreenshot: page !== undefined && page.screenshotPath !== null,
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

/** The suggestion first assessed: all the copies carried forward from it share this. */
const lineOf = (id: string, summary: SuggestionSummary): string => summary.originSuggestionId ?? id

/**
 * What is known of the suggestions decided on without a read: the current ones, and what they are
 * copies of. A copy says what its origin said, and an origin is the start of its own line.
 */
function summariesWithin(current: readonly Suggestion[]): Map<string, SuggestionSummary> {
  const known = new Map<string, SuggestionSummary>()
  for (const s of current) {
    known.set(s.id, { suggestedResult: s.suggestedResult, originSuggestionId: s.originSuggestionId })
    if (s.originSuggestionId) known.set(s.originSuggestionId, { suggestedResult: s.suggestedResult, originSuggestionId: null })
  }
  return known
}

/**
 * The latest decision for each item. A decision made on an earlier copy of the current suggestion
 * counts as made on the current one, so it is given the current id. On a suggestion that was really
 * assessed again it keeps its own id, and the card tells the auditor what changed. The current
 * suggestions answer most of this, and one batched read fetches the rest. A decision whose suggestion
 * cannot be found is left out.
 */
export async function latestDecisionViews(
  repo: EvidenceRepository,
  projectId: string,
  known: readonly Suggestion[],
): Promise<DecisionView[]> {
  const latest = [...latestDecisionPerItem(await repo.listDecisions(projectId)).values()]
  const summaries = summariesWithin(known)
  const missing = [...new Set(latest.map((d) => d.suggestionId).filter((id) => !summaries.has(id)))]
  if (missing.length > 0) {
    for (const [id, summary] of Object.entries(await repo.getSuggestionSummaries(missing))) summaries.set(id, summary)
  }
  const currentOf = new Map(known.map((s) => [s.itemId, s]))
  return latest.flatMap((d) => {
    const decidedOn = summaries.get(d.suggestionId)
    if (!decidedOn) return []
    const current = currentOf.get(d.itemId)
    const sameLine = current !== undefined && lineOf(d.suggestionId, decidedOn) === lineOf(current.id, current)
    return [toDecisionView(sameLine ? { ...d, suggestionId: current.id } : d, decidedOn.suggestedResult)]
  })
}
