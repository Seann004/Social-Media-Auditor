export type SuggestedResult = 'yes' | 'no' | 'partially' | 'not_applicable'
export type AnswerStatus = 'compliant' | 'non_compliant' | 'partially' | 'not_applicable'
export type Confidence = 'high' | 'medium' | 'low'

import type { RunSource } from './appTypes.js'

export type AccessStatus = 'ok' | 'error' | 'timeout' | 'login_required' | 'blocked'
export type RunStatus = 'queued' | 'capturing' | 'assessing' | 'completed' | 'failed' | 'partial'
export type RunScope = 'all' | 'unfinished'
export type SourceType = 'url' | 'test_account' | 'journey'

export type FlagType =
  | 'missing_evidence'
  | 'inaccessible'
  | 'conflicting'
  | 'unverified_quote'
  | 'low_confidence'
  | 'not_web_assessable'
  | 'comments_only'
  | 'default_unverified'

export interface ReviewFlag {
  type: FlagType
  reason: string
}

export interface EvidenceRun {
  id: string
  projectId: string
  startedBy: string | null
  status: RunStatus
  capturedInRunId: string
  scope: RunScope
  unassessedCategories: string[]
  categoriesTotal: number
  categoriesDone: number
  pagesTotal: number
  pagesDone: number
  tokensUsed: number
  model: string | null
  promptVersion: string
  /** Where the run got its evidence: captured pages or the platform's web app. */
  source: RunSource
  checkedItemIds: string[]
  uncheckedItemIds: string[]
  currentItemId: string | null
  currentStep: number
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface CapturedPage {
  id: string
  runId: string
  url: string
  finalUrl: string | null
  httpStatus: number | null
  accessStatus: AccessStatus
  accessDetail: string | null
  title: string | null
  text: string | null
  accessibilitySnapshot: unknown | null
  screenshotPath: string | null
  contentHash: string | null
  capturedAt: string
}

/** What a page is shown with: no text, no snapshot, no hash. */
export type PageSummary = Pick<
  CapturedPage,
  'id' | 'url' | 'finalUrl' | 'httpStatus' | 'accessStatus' | 'accessDetail' | 'title' | 'screenshotPath' | 'capturedAt'
>

export interface Passage {
  id: string
  pageId: string
  position: number
  kind: 'text' | 'controls'
  text: string
}

export interface SuggestionQuote {
  id: string
  /** Null when the AI named a passage that does not exist; the quote is kept, unverified. */
  passageId: string | null
  pageId: string | null
  quoteText: string
  verified: boolean
  highlightScreenshotPath: string | null
}

export interface Suggestion {
  id: string
  runId: string
  projectId: string
  itemId: string
  /** Null when the evidence does not settle the item. */
  suggestedResult: SuggestedResult | null
  reason: string
  confidence: Confidence
  flags: ReviewFlag[]
  /** Ids of the passages sent to the AI in the call that made this suggestion. Empty when no call was made. */
  passageIdsSent: string[]
  /** On a copy carried forward by a re-assess: the suggestion first assessed. Null when its run assessed it. */
  originSuggestionId: string | null
  source: RunSource
  quotes: SuggestionQuote[]
}

/** What is read of a suggestion from another run: what it said, and whose copy it is. */
export type SuggestionSummary = Pick<Suggestion, 'suggestedResult' | 'originSuggestionId'>

export interface Decision {
  id: string
  suggestionId: string
  projectId: string
  itemId: string
  userId: string | null
  decision: 'accepted' | 'overridden'
  finalResult: AnswerStatus
  overrideReason: string | null
  origin: 'card' | 'answer_button' | 'auto_match'
  decidedAt: string
}

const ANSWER_STATUS: Readonly<Record<SuggestedResult, AnswerStatus>> = {
  yes: 'compliant',
  no: 'non_compliant',
  partially: 'partially',
  not_applicable: 'not_applicable',
}

export function toAnswerStatus(r: SuggestedResult): AnswerStatus {
  return ANSWER_STATUS[r]
}
