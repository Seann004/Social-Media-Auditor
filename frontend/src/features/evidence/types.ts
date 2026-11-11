// Hand-written mirrors of the backend shapes; the frontend cannot import backend code.
// Keep in step with the file named on each type.

// Mirrors backend/src/features/evidence/types.ts
export type SuggestedResult = 'yes' | 'no' | 'partially' | 'not_applicable'
export type AnswerStatus = 'compliant' | 'non_compliant' | 'partially' | 'not_applicable'
export type Confidence = 'high' | 'medium' | 'low'
export type AccessStatus = 'ok' | 'error' | 'timeout' | 'login_required' | 'blocked'
export type RunStatus = 'queued' | 'capturing' | 'assessing' | 'completed' | 'failed' | 'partial'
export type RunScope = 'all' | 'unfinished'
// Mirrors backend/src/features/evidence/appTypes.ts
export type RunSource = 'pages' | 'app' | 'repo'
export type AgeGroup = 'under_18' | 'adult'
export type AppStepOutcome = 'done' | 'refused' | 'failed' | 'blocked'
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

// Mirrors RunView in backend/src/features/evidence/views.ts (EvidenceRun, categories by display name)
export interface RunView {
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

// Mirrors PageView in backend/src/features/evidence/views.ts
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

// Mirrors QuoteView in backend/src/features/evidence/views.ts
export interface QuoteView {
  id: string
  pageId: string | null
  quoteText: string
  verified: boolean
  pageUrl: string | null
  pageTitle: string | null
  hasHighlight: boolean
  /** Whether the quote's page has a screenshot: a code piece never has one. */
  pageHasScreenshot: boolean
}

// Mirrors SuggestionView in backend/src/features/evidence/views.ts (Suggestion without passageIdsSent)
export interface SuggestionView {
  id: string
  runId: string
  projectId: string
  itemId: string
  source: RunSource
  suggestedResult: SuggestedResult | null
  reason: string
  confidence: Confidence
  flags: ReviewFlag[]
  quotes: QuoteView[]
  /** For a repo suggestion: the commit its code was read at. Null when unknown or not a repo suggestion. */
  commitSha: string | null
  /** For a repo suggestion: whether any code was kept or sent for it. False for other sources. */
  hasCode: boolean
}

// Mirrors DecisionView in backend/src/features/evidence/views.ts
export interface DecisionView {
  id: string
  suggestionId: string
  itemId: string
  userId: string | null
  decision: 'accepted' | 'overridden'
  finalResult: AnswerStatus
  overrideReason: string | null
  origin: 'card' | 'answer_button' | 'auto_match'
  decidedAt: string
  suggestedResult: SuggestedResult | null
}

// Mirrors EvidenceSource and EvidencePermission in backend/src/features/evidence/repository.ts
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

// Mirrors AppliedAnswer and EvidenceImage in backend/src/features/evidence/auditData.ts
export interface EvidenceImage {
  url: string
  name: string
}

export interface AppliedAnswer {
  itemId: string
  status: AnswerStatus
  findings: string | null
  /** The deciding auditor's own photos. A decision never copies photos between auditors' rows. */
  evidenceImages: EvidenceImage[]
}

// Response bodies of backend/src/features/evidence/routes.ts
export interface SourcesResponse {
  source: EvidenceSource | null
  permission: EvidencePermission | null
}
export interface RunStartResponse {
  run: RunView
}
export interface LatestRunResponse {
  run: RunView | null
  pages: PageView[]
}
export interface SuggestionsResponse {
  run: RunView | null
  suggestions: SuggestionView[]
  decisions: DecisionView[]
}
export interface DecisionRequest {
  decision: 'accepted' | 'overridden'
  origin: 'card' | 'answer_button'
  finalResult?: AnswerStatus
  overrideReason?: string
  /** Findings typed and not yet saved. The server writes them with the decision. */
  findings?: string
  /** Notes typed and not yet saved. */
  notes?: string
}
export interface DecisionResponse {
  decision: DecisionView
  answer: AppliedAnswer
}
export type ScreenshotKind = 'page' | 'quote'

// Mirrors backend/src/features/evidence/appViews.ts. A password is write-only: no view carries it.
export interface TestAccountView {
  id: string
  label: string
  ageGroup: AgeGroup
  age: number | null
  loginName: string
  handles: string[]
  hasPassword: true
  updatedAt: string
}
export interface AppSourceView {
  appUrl: string
  loginDomains: string[]
  updatedAt: string
}
export interface AppStepView {
  id: string
  position: number
  accountLabel: string | null
  line: string
  outcome: AppStepOutcome
  refusalReason: string | null
  pageId: string | null
  hasScreenshot: boolean
  /** The early-finish nudge: stored as a refusal, shown as a hint to look further. */
  hint: boolean
}
export interface AppChangeView {
  id: string
  itemId: string
  accountLabel: string
  pageUrl: string
  control: string
  before: string
  after: string
  restored: boolean
  restoreDetail: string | null
}

// Response and request bodies of backend/src/features/evidence/appRoutes.ts
export interface AppSetupResponse {
  app: AppSourceView | null
  accounts: TestAccountView[]
  secretKeyConfigured: boolean
}
/** `password` is required to add an account; on an update, leave it out or empty to keep the saved one. */
export interface TestAccountInput {
  label: string
  ageGroup: AgeGroup
  age: number | null
  loginName: string
  password?: string
  handles: string[]
}
export interface StepsResponse {
  steps: AppStepView[]
  changes: AppChangeView[]
}

// Mirrors the repository views of backend/src/features/evidence (repo-source and code routes)
export interface RepoSourceView {
  repoUrl: string
  branch: string | null
  updatedAt: string
}
export interface CodePieceView {
  id: string
  path: string
  startLine: number
  endLine: number
  code: string
  url: string
  round: number
  quoted: boolean
}
export interface CodeEvidence {
  commitSha: string | null
  repoUrl: string | null
  pieces: CodePieceView[]
}

/** Shown label for each flag type that needs a short name. */
export const FLAG_LABEL: Partial<Record<FlagType, string>> = {
  comments_only: 'Comments only',
  default_unverified: 'Check the default',
}
