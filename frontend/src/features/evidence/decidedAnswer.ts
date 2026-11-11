import type { AppliedAnswer, EvidenceImage } from './types'

export interface PageUpdate {
  /** New text for the findings box, or undefined to leave it. */
  findings?: string
  /** The deciding auditor's photos after the decision (the page reloads every auditor's photos), or undefined to leave them. */
  images?: EvidenceImage[]
}

/**
 * What the audit page's own state (findings box, photos) must take from a saved decision.
 * Null findings leave the box alone. An override can come back with no photos; that must not wipe the ones on the page.
 */
export function pageUpdateAfterDecision(answer: AppliedAnswer, decision: 'accepted' | 'overridden'): PageUpdate {
  return {
    ...(answer.findings !== null ? { findings: answer.findings } : {}),
    ...(decision === 'accepted' || answer.evidenceImages.length > 0 ? { images: answer.evidenceImages } : {}),
  }
}
