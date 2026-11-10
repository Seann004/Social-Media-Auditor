import type { RunSource, StoppedBy } from './appTypes.js'
import type { AccessStatus, Confidence, ReviewFlag, SuggestedResult } from './types.js'

export interface FlagInput {
  suggestedResult: SuggestedResult | null
  evidenceSufficient: boolean
  conflicting: boolean
  webAssessable: boolean
  confidence: Confidence
  aiReason: string
  passagesFound: number
  quotes: { text: string; verified: boolean }[]
  failedPages: { url: string; status: AccessStatus }[]
  /** Defaults to 'pages'. */
  source?: RunSource
  /** The page that ended an app check (a captcha, a 2-factor prompt, a bot check). */
  stoppedBy?: StoppedBy | null
  /** A repo check whose verified quotes all come from comments, docs or tests. */
  commentsOnly?: boolean
  /** An app check of an item about a default setting (see `isAboutDefault`). */
  aboutDefault?: boolean
}

const MAX_URLS_NAMED = 3
const NO_QUOTE_REASON = 'The AI gave this result without quoting any captured page.'
const NOT_ASSESSABLE_REASON: Readonly<Record<RunSource, string>> = {
  pages: "This item needs internal evidence, which a website can't show.",
  app: "This item needs evidence the app can't show.",
  repo: "This item needs evidence the code can't show.",
}
const CLAIM_RESULTS: readonly SuggestedResult[] = ['yes', 'no', 'partially']
const DEFAULT_WORDING = /\bby default\b|\bdefaults?\b|\bdefault(ing)? to\b/i
const DEFAULT_UNVERIFIED_REASON =
  "This item is about a default setting, but the check only saw this account's current setting. Confirm the default yourself, for example with a newly created account."

/** Whether a checklist item's text or name is about a default setting ("private by default"). */
export function isAboutDefault(text: string): boolean {
  return DEFAULT_WORDING.test(text)
}

const STATUS_WORDS: Readonly<Record<AccessStatus, string>> = {
  ok: 'could not be used',
  error: 'returned an error',
  timeout: 'timed out',
  login_required: 'required a login',
  blocked: 'blocked access',
}

function reasonFromAi(aiReason: string, fallback: string): string {
  const trimmed = aiReason.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function inaccessibleReason(failed: FlagInput['failedPages']): string {
  const named = failed
    .slice(0, MAX_URLS_NAMED)
    .map((p) => `${p.url} (${STATUS_WORDS[p.status]})`)
    .join('; ')
  const extra = failed.length - MAX_URLS_NAMED
  const more = extra > 0 ? ` and ${extra} more` : ''
  return `Some pages could not be captured: ${named}${more}.`
}

export function computeFlags(input: FlagInput): ReviewFlag[] {
  const flags: ReviewFlag[] = []

  const noQuotedClaim =
    input.suggestedResult !== null &&
    CLAIM_RESULTS.includes(input.suggestedResult) &&
    input.quotes.length === 0
  const evidenceShort = input.passagesFound === 0 || !input.evidenceSufficient

  if (evidenceShort) {
    flags.push({
      type: 'missing_evidence',
      reason: reasonFromAi(input.aiReason, 'No captured page clearly covers this item.'),
    })
  } else if (noQuotedClaim) {
    flags.push({ type: 'missing_evidence', reason: NO_QUOTE_REASON })
  }

  if (input.stoppedBy) {
    // Whatever the evidence: the check never got past this page.
    flags.push({ type: 'inaccessible', reason: `The check stopped at ${input.stoppedBy.url}: ${input.stoppedBy.detail}` })
  } else if (evidenceShort && input.failedPages.length > 0) {
    flags.push({ type: 'inaccessible', reason: inaccessibleReason(input.failedPages) })
  }

  if (input.conflicting) {
    flags.push({
      type: 'conflicting',
      reason: reasonFromAi(input.aiReason, 'The captured pages give conflicting information on this item.'),
    })
  }

  if (input.quotes.some((q) => !q.verified)) {
    flags.push({
      type: 'unverified_quote',
      reason: 'One quoted sentence could not be found in the captured page.',
    })
  }

  if (input.confidence === 'low') {
    flags.push({ type: 'low_confidence', reason: 'The AI marked this suggestion as low confidence.' })
  }

  if (
    input.commentsOnly &&
    input.suggestedResult !== null &&
    CLAIM_RESULTS.includes(input.suggestedResult)
  ) {
    flags.push({ type: 'comments_only', reason: 'Only comments or documentation support this.' })
  }

  // An app check sees one account's current setting, which does not prove the default. Code can show
  // a default, and pages state it, so only app checks get this flag.
  if (
    input.source === 'app' &&
    input.aboutDefault === true &&
    input.suggestedResult !== null &&
    CLAIM_RESULTS.includes(input.suggestedResult)
  ) {
    flags.push({ type: 'default_unverified', reason: DEFAULT_UNVERIFIED_REASON })
  }

  // For app and repo checks, a null result with too little evidence is already missing_evidence: the AI
  // often marks such items not assessable although a screen or the code could show them.
  const source = input.source ?? 'pages'
  const coveredByMissing = source !== 'pages' && input.suggestedResult === null && evidenceShort
  if (!input.webAssessable && !coveredByMissing) {
    flags.push({
      type: 'not_web_assessable',
      reason: NOT_ASSESSABLE_REASON[source],
    })
  }

  return flags
}
