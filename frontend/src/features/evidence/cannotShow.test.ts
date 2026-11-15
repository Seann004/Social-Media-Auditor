import { describe, expect, it } from 'vitest'
import { APP_NO_STEPS_REASON, REPO_TRUNCATED_REASON, cannotShowReason } from './cannotShow'
import { makeSuggestion } from './testFixtures'

const POLICY_ITEM = { text: 'The privacy policy for younger users is easy to find.' }
const APP_ITEM = { text: 'Accounts of users under 16 are private by default.' }
const CODE_ITEM = { text: 'Passwords are stored hashed, never in plain text.' }
const BOTH_ITEM = { text: 'Users must enter their date of birth when they sign up.' }

const POLICY_REASON = 'It is a policy or process item (it mentions “policy”).'
const missing = { type: 'missing_evidence' as const, reason: 'The app shows nothing about this.' }
const noResult = (source: 'app' | 'repo' | 'pages', over = {}) =>
  makeSuggestion({ source, suggestedResult: null, reason: 'The app shows nothing about this.', flags: [missing], ...over })

describe('cannotShowReason', () => {
  it.each([
    ['app', POLICY_ITEM, POLICY_REASON],
    ['repo', POLICY_ITEM, POLICY_REASON],
    ['app', CODE_ITEM, 'It is about how the service is built (it mentions “stored”).'],
    ['repo', APP_ITEM, 'It is about something a user can see or change in the app (it mentions “private”).'],
  ] as const)('gives the reason for a %s suggestion with no result on an item that source cannot show', (source, item, reason) => {
    expect(cannotShowReason({ suggestion: noResult(source), item })).toBe(reason)
  })

  it('is null when the suggestion has a result', () => {
    expect(cannotShowReason({ suggestion: noResult('app', { suggestedResult: 'no' }), item: POLICY_ITEM })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('repo', { suggestedResult: 'not_applicable' }), item: APP_ITEM })).toBeNull()
  })

  it('is null when the item suits the source', () => {
    expect(cannotShowReason({ suggestion: noResult('app'), item: APP_ITEM })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('repo'), item: CODE_ITEM })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('app'), item: BOTH_ITEM })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('repo'), item: BOTH_ITEM })).toBeNull()
  })

  it('is null for a Public pages suggestion, which keeps its own wording', () => {
    expect(cannotShowReason({ suggestion: noResult('pages'), item: POLICY_ITEM })).toBeNull()
  })

  it('is null when the check failed, so the failure wording stays', () => {
    const stopped = { type: 'inaccessible' as const, reason: 'The check stopped at https://app.example/login: a captcha.' }
    expect(cannotShowReason({ suggestion: noResult('app', { flags: [missing, stopped] }), item: POLICY_ITEM })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('app', { reason: APP_NO_STEPS_REASON }), item: POLICY_ITEM })).toBeNull()
    expect(cannotShowReason({ suggestion: noResult('repo', { reason: REPO_TRUNCATED_REASON }), item: APP_ITEM })).toBeNull()
  })

  it('is null for an item the run left unchecked', () => {
    expect(cannotShowReason({ suggestion: noResult('app'), item: POLICY_ITEM, unchecked: true })).toBeNull()
  })

  it('is null without the item', () => {
    expect(cannotShowReason({ suggestion: noResult('app') })).toBeNull()
  })

  it('mirrors the backend failure sentences', () => {
    expect(APP_NO_STEPS_REASON).toBe('The check ended before any page of the app could be recorded.')
    expect(REPO_TRUNCATED_REASON).toBe(
      'No code in the repository matches this item. Only the first part of the repository was read, because it is larger than the limits.',
    )
  })
})
