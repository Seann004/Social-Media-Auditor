import type { AppliedAnswer, AuditData, EvidenceImage } from './auditData.js'
import {
  ACCEPTED_EVIDENCE_LINK_SECONDS,
  LOCKED_SUBMISSION_STATUSES,
  MAX_DECISION_FINDINGS_CHARS,
  MAX_DECISION_NOTES_CHARS,
  MAX_HIGHLIGHTS_PER_SUGGESTION,
  MAX_OVERRIDE_REASON_CHARS,
} from './config.js'
import type { EvidenceRepository, ScreenshotStore } from './repository.js'
import { toAnswerStatus, type AnswerStatus, type Decision, type Suggestion } from './types.js'

const ANSWER_STATUSES: readonly AnswerStatus[] = ['compliant', 'non_compliant', 'partially', 'not_applicable']
const MIN_REASON_LENGTH = 3
const DECISIONS: readonly string[] = ['accepted', 'overridden']
const ORIGINS: readonly string[] = ['card', 'answer_button']
const IMAGE_NAME_PREFIX = 'AI evidence'

export class DecisionError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422,
  ) {
    super(message)
    this.name = 'DecisionError'
  }
}

export interface DecisionInput {
  suggestionId: string
  userId: string
  decision: 'accepted' | 'overridden'
  finalResult?: AnswerStatus
  overrideReason?: string
  origin: 'card' | 'answer_button'
  /** Findings the auditor typed and had not saved. */
  findings?: string
  /** Notes the auditor typed and had not saved. */
  notes?: string
}

export interface DecisionDeps {
  repo: EvidenceRepository
  audit: Pick<AuditData, 'listChecklistItems' | 'getSubmissionStatus' | 'applyAnswer'>
  screenshots: ScreenshotStore
}

/** The most recent decision for each item. Ties go to the one later in the list. */
export function latestDecisionPerItem(decisions: Decision[]): Map<string, Decision> {
  const latest = new Map<string, Decision>()
  for (const d of decisions) {
    const current = latest.get(d.itemId)
    if (!current || d.decidedAt >= current.decidedAt) latest.set(d.itemId, d)
  }
  return latest
}

/** A stable name, so signing the same picture again does not add it a second time. */
function imageName(path: string): string {
  return `${IMAGE_NAME_PREFIX} ${path.split('/').pop() ?? path}`
}

/** Storage paths of the pictures to attach: close-ups of verified quotes, else the page, once per page. */
async function evidencePaths(suggestion: Suggestion, repo: EvidenceRepository): Promise<string[]> {
  const paths: string[] = []
  const pagesUsed = new Set<string>()
  for (const quote of suggestion.quotes) {
    if (paths.length >= MAX_HIGHLIGHTS_PER_SUGGESTION) break
    if (!quote.verified) continue
    let path = quote.highlightScreenshotPath
    if (!path && quote.pageId && !pagesUsed.has(quote.pageId)) {
      pagesUsed.add(quote.pageId)
      path = (await repo.getPage(quote.pageId))?.screenshotPath ?? null
    }
    if (path && !paths.includes(path)) paths.push(path)
  }
  return paths
}

async function signEvidence(
  suggestion: Suggestion,
  deps: DecisionDeps,
): Promise<EvidenceImage[]> {
  const images: EvidenceImage[] = []
  for (const path of await evidencePaths(suggestion, deps.repo)) {
    try {
      images.push({ url: await deps.screenshots.signedUrl(path, ACCEPTED_EVIDENCE_LINK_SECONDS), name: imageName(path) })
    } catch (err) {
      console.error(`Could not sign the evidence picture ${path} for suggestion ${suggestion.id}; leaving it out.`, err)
    }
  }
  return images
}

interface Plan {
  result: AnswerStatus
  overrideReason: string | null
}

function checkText(value: unknown, what: string, max: number): void {
  if (value === undefined) return
  if (typeof value !== 'string') throw new DecisionError(`${what} must be text.`, 422)
  if (value.length > max) throw new DecisionError(`${what} can be at most ${max} characters.`, 422)
}

/** The shape of the request, checked before anything is read or written. */
function checkShape(input: DecisionInput): void {
  if (!DECISIONS.includes(input.decision)) throw new DecisionError('The decision must be accepted or overridden.', 422)
  if (!ORIGINS.includes(input.origin)) throw new DecisionError('The origin must be card or answer_button.', 422)
  checkText(input.findings, 'The findings', MAX_DECISION_FINDINGS_CHARS)
  checkText(input.notes, 'The notes', MAX_DECISION_NOTES_CHARS)
  if (input.decision !== 'overridden') return
  const reason = input.overrideReason
  if (reason !== undefined && typeof reason !== 'string') throw new DecisionError('The reason must be text.', 422)
  if ((reason ?? '').length > MAX_OVERRIDE_REASON_CHARS) {
    throw new DecisionError(`The reason can be at most ${MAX_OVERRIDE_REASON_CHARS} characters.`, 422)
  }
}

function plan(input: DecisionInput, suggestion: Suggestion): Plan {
  if (input.decision === 'accepted') {
    if (!suggestion.suggestedResult) throw new DecisionError('The AI did not suggest a result, so there is nothing to accept.', 422)
    return { result: toAnswerStatus(suggestion.suggestedResult), overrideReason: null }
  }
  const reason = input.overrideReason?.trim() ?? ''
  if (!input.finalResult || !ANSWER_STATUSES.includes(input.finalResult)) {
    throw new DecisionError('Choose the result to override with.', 422)
  }
  if (reason.length < MIN_REASON_LENGTH) {
    throw new DecisionError(`Give a reason of at least ${MIN_REASON_LENGTH} characters.`, 422)
  }
  if (suggestion.suggestedResult && toAnswerStatus(suggestion.suggestedResult) === input.finalResult) {
    throw new DecisionError('That is the suggested result. Accept the suggestion instead.', 422)
  }
  return { result: input.finalResult, overrideReason: reason }
}

/**
 * Applies the auditor's decision to the shared answer, then records it. Nothing is written until
 * every check has passed. If recording fails the error reaches the auditor; retrying is safe.
 */
export async function recordDecision(
  input: DecisionInput,
  deps: DecisionDeps,
): Promise<{ decision: Decision; answer: AppliedAnswer }> {
  checkShape(input)
  const suggestion = await deps.repo.getSuggestion(input.suggestionId)
  if (!suggestion) throw new DecisionError('That suggestion no longer exists.', 404)
  const { projectId, itemId } = suggestion

  const submission = await deps.audit.getSubmissionStatus(projectId)
  if (submission === null) throw new DecisionError('The project no longer exists.', 404)
  if (LOCKED_SUBMISSION_STATUSES.includes(submission)) {
    throw new DecisionError('The audit has been submitted, so its answers can no longer change.', 409)
  }

  const item = (await deps.audit.listChecklistItems(projectId)).find((i) => i.id === itemId)
  if (!item) throw new DecisionError('That checklist item is no longer part of the project.', 404)

  const { result, overrideReason } = plan(input, suggestion)
  const accepting = input.decision === 'accepted'

  const answer = await deps.audit.applyAnswer({
    projectId,
    itemId,
    guidelineId: item.guidelineId,
    userId: input.userId,
    result,
    ...(input.findings !== undefined ? { typedFindings: input.findings } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(accepting ? { findingsIfEmpty: suggestion.reason, addImages: await signEvidence(suggestion, deps) } : {}),
  })

  const decision = await deps.repo.addDecision({
    suggestionId: suggestion.id,
    projectId,
    itemId,
    userId: input.userId,
    decision: input.decision,
    finalResult: result,
    overrideReason,
    origin: input.origin,
  })
  return { decision, answer }
}
