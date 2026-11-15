import { describe, expect, it } from 'vitest'
import { APP_NO_STEPS_REASON, REPO_TRUNCATED_REASON, cannotShowReason } from './cannotShow'
import { makeSuggestion } from './testFixtures'
import type { ItemKindView } from './types'

// The AI's high-confidence kinds: the only ones the server sends.
const POLICY: ItemKindView = { kind: 'neither', reason: 'A company policy, not a screen or code.' }
const APP: ItemKindView = { kind: 'app', reason: 'A setting a user can see.' }
const CODE: ItemKindView = { kind: 'code', reason: 'Only the server shows it.' }
const BOTH: ItemKindView = { kind: 'both', reason: 'Seen in the app and set in the code.' }

const missing = { type: 'missing_evidence' as const, reason: 'The app shows nothing about this.' }
const noResult = (source: 'app' | 'repo' | 'pages', over = {}) =>
  makeSuggestion({ source, suggestedResult: null, reason: 'The app shows nothing about this.', flags: [missing], ...over })

describe('cannotShowReason', () => {
  it.each([
    ['app', POLICY],
    ['repo', POLICY],
    ['app', CODE],
    ['repo', APP],
  ] as const)("gives the AI's reason for a %s suggestion with no result on an item that source cannot show", (source, kind) => {
    expect(cannotShowReason({ suggestion: noResult(source), kind })).toBe(kind.reason)
  })

  it('is null when the suggestion has a result', () => {
    expect(cannotShowReason({ suggestion: noResult('app', { suggestedResult: 'no' }), kind: POLICY })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('repo', { suggestedResult: 'not_applicable' }), kind: APP })).toBeNull()
  })

  it('is null when the item suits the source', () => {
    expect(cannotShowReason({ suggestion: noResult('app'), kind: APP })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('repo'), kind: CODE })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('app'), kind: BOTH })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('repo'), kind: BOTH })).toBeNull()
  })

  it('is null for a Public pages suggestion, which keeps its own wording', () => {
    expect(cannotShowReason({ suggestion: noResult('pages'), kind: POLICY })).toBeNull()
  })

  it('is null when the check failed, so the failure wording stays', () => {
    const stopped = { type: 'inaccessible' as const, reason: 'The check stopped at https://app.example/login: a captcha.' }
    expect(cannotShowReason({ suggestion: noResult('app', { flags: [missing, stopped] }), kind: POLICY })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('app', { reason: APP_NO_STEPS_REASON }), kind: POLICY })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('repo', { reason: REPO_TRUNCATED_REASON }), kind: APP })).toBeNull()
  })

  it('is null for an item the run left unchecked', () => {
    expect(cannotShowReason({ suggestion: noResult('app'), kind: POLICY, unchecked: true })).toBeNull()
  })

  it('is null without a high-confidence kind from the AI (still loading, failed, or unsure)', () => {
    expect(cannotShowReason({ suggestion: noResult('app') })).toBeNull()
  })

  it('mirrors the backend failure sentences', () => {
    expect(APP_NO_STEPS_REASON).toBe('The check ended before any page of the app could be recorded.')
    expect(REPO_TRUNCATED_REASON).toBe(
      'No code in the repository matches this item. Only the first part of the repository was read, because it is larger than the limits.',
    )
  })
})
