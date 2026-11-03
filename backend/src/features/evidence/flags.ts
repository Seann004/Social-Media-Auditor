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
}

const MAX_URLS_NAMED = 3
const CLAIM_RESULTS: readonly SuggestedResult[] = ['yes', 'no', 'partially']

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

  if (evidenceShort || noQuotedClaim) {
    flags.push({
      type: 'missing_evidence',
      reason: reasonFromAi(input.aiReason, 'No captured page clearly covers this item.'),
    })
  }

  if (evidenceShort && input.failedPages.length > 0) {
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

  if (!input.webAssessable) {
    flags.push({
      type: 'not_web_assessable',
      reason: "This item needs internal evidence, which a website can't show.",
    })
  }

  return flags
}
