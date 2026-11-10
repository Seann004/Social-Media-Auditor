import type { RunSource } from './appTypes.js'
import type {
  AnswerStatus,
  CapturedPage,
  Confidence,
  Decision,
  EvidenceRun,
  PageSummary,
  Passage,
  ReviewFlag,
  RunScope,
  SuggestedResult,
  Suggestion,
  SuggestionQuote,
  SuggestionSummary,
} from './types.js'

export interface EvidenceSource {
  id: string
  projectId: string
  startUrls: string[]
  createdBy: string | null
  createdAt: string
}

export interface EvidencePermission {
  id: string
  projectId: string
  granted: boolean
  note: string | null
  recordedBy: string | null
  recordedAt: string
}

export interface NewRun {
  projectId: string
  startedBy: string | null
  scope: RunScope
  /** Run whose pages are reused. Defaults to the new run itself (a capture run). */
  capturedInRunId?: string
  categoriesTotal?: number
  pagesTotal?: number
  /** Defaults to 'pages'. */
  source?: RunSource
  /** Defaults to none. */
  checkedItemIds?: string[]
  /** Defaults to PROMPT_VERSION. */
  promptVersion?: string
}

export type RunPatch = Partial<Omit<EvidenceRun, 'id' | 'projectId' | 'createdAt'>>

export type NewPage = Omit<CapturedPage, 'id' | 'runId' | 'capturedAt'>

export interface NewPassage {
  position: number
  kind: 'text' | 'controls'
  text: string
}

export interface NewSuggestion {
  runId: string
  projectId: string
  itemId: string
  suggestedResult: SuggestedResult | null
  reason: string
  confidence: Confidence
  flags: ReviewFlag[]
  passageIdsSent: string[]
  /** Only for a copy carried forward. Defaults to null: the run assessed it itself. */
  originSuggestionId?: string | null
  /** Defaults to 'pages'. */
  source?: RunSource
  quotes: Omit<SuggestionQuote, 'id'>[]
}

export interface NewDecision {
  suggestionId: string
  projectId: string
  itemId: string
  userId: string | null
  decision: 'accepted' | 'overridden'
  finalResult: AnswerStatus
  overrideReason: string | null
  origin: 'card' | 'answer_button' | 'auto_match'
}

export interface EvidenceRepository {
  saveSource(projectId: string, startUrls: string[], userId: string | null): Promise<EvidenceSource>
  getSource(projectId: string): Promise<EvidenceSource | null>

  getPermission(projectId: string): Promise<EvidencePermission | null>
  setPermission(
    projectId: string,
    granted: boolean,
    note: string | null,
    userId: string | null,
  ): Promise<EvidencePermission>

  createRun(input: NewRun): Promise<EvidenceRun>
  updateRun(id: string, patch: RunPatch): Promise<EvidenceRun>
  getRun(id: string): Promise<EvidenceRun | null>
  latestRun(projectId: string): Promise<EvidenceRun | null>
  /** Latest run with status completed or partial. */
  latestResultRun(projectId: string): Promise<EvidenceRun | null>
  countRunsSince(projectId: string, iso: string): Promise<number>
  /** Latest run that is queued, capturing or assessing. */
  activeRun(projectId: string): Promise<EvidenceRun | null>
  /** Fails every queued, capturing or assessing run. Returns how many. */
  markInterruptedRuns(): Promise<number>

  addPage(runId: string, page: NewPage): Promise<CapturedPage>
  listPages(capturedInRunId: string): Promise<CapturedPage[]>
  /** Only the columns a view needs, for the polled routes. The runner reads whole pages with listPages. */
  listPageSummaries(capturedInRunId: string): Promise<PageSummary[]>
  getPage(id: string): Promise<CapturedPage | null>

  addPassages(pageId: string, passages: NewPassage[]): Promise<Passage[]>
  /** The passages of the given pages, in the order of `pageIds`, then by position. Empty for no ids. */
  listPassagesOfPages(pageIds: string[]): Promise<Passage[]>
  /** The summary of each known page, whichever run captured it. Unknown ids are left out. */
  getPageSummaries(ids: string[]): Promise<PageSummary[]>
  /** Matches ANY query term, best match first. */
  searchPassages(capturedInRunId: string, query: string, limit: number): Promise<Passage[]>

  /** Throws if the run already has a suggestion for the item. */
  addSuggestion(input: NewSuggestion): Promise<Suggestion>
  listSuggestions(runId: string): Promise<Suggestion[]>
  getSuggestion(id: string): Promise<Suggestion | null>
  /** The summary of each known id, in one read. Unknown ids are left out. */
  getSuggestionSummaries(ids: string[]): Promise<Record<string, SuggestionSummary>>
  /** The run of each suggestion, in one batched read; unknown ids are left out. */
  getSuggestionRunIds(ids: string[]): Promise<Record<string, string>>
  getQuote(id: string): Promise<SuggestionQuote | null>

  addDecision(input: NewDecision): Promise<Decision>
  /** Every decision for the project, oldest first. */
  listDecisions(projectId: string): Promise<Decision[]>
}

export interface ScreenshotStore {
  upload(path: string, jpeg: Buffer): Promise<void>
  signedUrl(path: string, seconds: number): Promise<string>
  /** Removes every object under `<projectId>/`. */
  removeProject(projectId: string): Promise<void>
}
