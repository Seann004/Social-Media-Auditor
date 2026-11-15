import { describe, expect, it } from 'vitest'
import { KIND_LABEL, betterSourceHint, fitsSource, suggestEvidenceKind } from './evidenceKind'

const kindOf = (text: string) => suggestEvidenceKind({ text }).kind

describe('suggestEvidenceKind: the three keyword lists', () => {
  it('calls a policy or process item neither, naming the word', () => {
    expect(suggestEvidenceKind({ text: 'The privacy policy for younger users is easy to find.' })).toEqual({
      kind: 'neither',
      reason: 'It is a policy or process item (it mentions “policy”).',
    })
  })

  it.each([
    'Staff who review reports receive training.',
    'An annual audit is carried out.',
    'There is an appeal process for removed posts.',
    'Moderators handle urgent reports.',
    'Concerns are reported to the regulator.',
    'The review process is documented.',
    'The board oversees governance of child safety.',
    'The terms of service are short.',
  ])('neither: %s', (text) => {
    expect(kindOf(text)).toBe('neither')
  })

  it('calls an item about something a user can see or change app, naming the first word', () => {
    expect(suggestEvidenceKind({ text: 'Accounts of users under 16 are private by default.' })).toEqual({
      kind: 'app',
      reason: 'It is about something a user can see or change in the app (it mentions “private”).',
    })
  })

  it.each([
    'Safety settings are easy to change.',
    'A toggle hides the activity status.',
    'Teens can block or mute any account.',
    'Each post has a report button.',
    'Only friends can message a teen.',
    'Strangers can follow a teen only after approval.',
    'Teens get a notification when someone tags them.',
    'Users can opt out of personalised feeds.',
    'The follower list is not visible to strangers.',
  ])('app: %s', (text) => {
    expect(kindOf(text)).toBe('app')
  })

  it('calls an item about how the service is built code, naming the word', () => {
    expect(suggestEvidenceKind({ text: 'Passwords are stored hashed.' })).toEqual({
      kind: 'code',
      reason: 'It is about how the service is built (it mentions “stored”).',
    })
  })

  it.each([
    'An age check runs before the first post.',
    'Messages are encrypted at rest.',
    'Login attempts are rate limited.',
    'Chat logs are deleted after 30 days.',
    'The retention period for messages is short.',
    'A consent record is kept for each child.',
    'The service can verify age with a provider.',
  ])('code: %s', (text) => {
    expect(kindOf(text)).toBe('code')
  })

  it('calls an item with app words and code words both, naming one of each', () => {
    expect(suggestEvidenceKind({ text: 'Users must enter their date of birth when they sign up.' })).toEqual({
      kind: 'both',
      reason: 'It mentions something a user can see in the app (“sign up”) and something only the code shows (“date of birth”).',
    })
  })

  it('calls an item that matches nothing both, and never guesses neither', () => {
    expect(suggestEvidenceKind({ text: 'The catalogue and login pages load quickly.' })).toEqual({
      kind: 'both',
      reason: 'No word points to one source, so either may help.',
    })
    expect(kindOf('')).toBe('both')
  })
})

describe('suggestEvidenceKind: the order of the rules', () => {
  it('lets a policy word beat weak app or code words, which policies also use', () => {
    expect(kindOf('The data retention policy is documented.')).toBe('neither')
    expect(kindOf('The privacy policy is shown in the settings.')).toBe('neither')
  })

  it('lets a strong behaviour or build word beat a policy word', () => {
    expect(suggestEvidenceKind({ text: 'Every moderation action is written to an audit log.' })).toEqual({
      kind: 'code',
      reason: 'It is about how the service is built (it mentions “audit log”).',
    })
    expect(kindOf('Our policy lets teens block any account.')).toBe('app')
  })

  it('then takes app and code words together, so a strong app word with a code word is both', () => {
    expect(kindOf('Staff can toggle encryption for a chat.')).toBe('both')
  })

  it('names the word that comes first in the item', () => {
    expect(suggestEvidenceKind({ text: 'Staff training and policy are reviewed.' }).reason).toBe('It is a policy or process item (it mentions “staff”).')
    expect(suggestEvidenceKind({ text: 'Policy for staff training.' }).reason).toBe('It is a policy or process item (it mentions “policy”).')
  })

  it('is the same for the same item, every time', () => {
    const item = { text: 'Teens can turn off comments, and comments are stored for 30 days.', itemName: 'Comments' }
    expect(suggestEvidenceKind(item)).toEqual(suggestEvidenceKind(item))
  })
})

describe('suggestEvidenceKind: words and fields', () => {
  it('matches whole words and phrases only', () => {
    expect(kindOf('Privacy matters to us.')).toBe('both') // not "private"
    expect(kindOf('The blog is updated.')).toBe('both') // not "log"
    expect(kindOf('Searching self-harm terms gives no results.')).toBe('both') // "terms" alone is not "terms of service"
  })

  it('ignores case and accepts common endings', () => {
    expect(kindOf('ENCRYPTED AT REST')).toBe('code')
    expect(kindOf('Messages are logged.')).toBe('code')
    expect(kindOf('Muted accounts stay muted.')).toBe('app')
  })

  it('reads the item name and the text together', () => {
    expect(suggestEvidenceKind({ itemName: 'Private profiles', text: 'P-1' }).kind).toBe('app')
    expect(suggestEvidenceKind({ itemName: 'Teen profiles', text: 'They are encrypted.' }).kind).toBe('code')
  })

  it('reads the help text and the category only when the item itself matches nothing', () => {
    expect(suggestEvidenceKind({ text: 'Children are kept safe.', category: 'Governance' })).toEqual({
      kind: 'neither',
      reason: 'It is a policy or process item (its category or help text mentions “governance”).',
    })
    expect(suggestEvidenceKind({ text: 'Accounts are private.', category: 'Governance', helpText: 'See the privacy policy.' }).kind).toBe('app')
    expect(suggestEvidenceKind({ text: 'Teens are protected.', helpText: 'Open the safety settings.' }).kind).toBe('app')
  })
})

describe('the chip and the better-source hint', () => {
  it('labels each kind', () => {
    expect(KIND_LABEL).toEqual({ app: 'App', code: 'Code', both: 'App + Code', neither: 'Policy / process' })
  })

  it.each([
    ['app', 'app', true],
    ['app', 'repo', false],
    ['code', 'repo', true],
    ['code', 'app', false],
    ['both', 'app', true],
    ['both', 'repo', true],
    ['neither', 'app', false],
    ['neither', 'repo', false],
  ] as const)('a %s item fits the %s source: %s', (kind, source, fits) => {
    expect(fitsSource(kind, source)).toBe(fits)
  })

  it.each([
    ['code', 'app', 'Better checked with Code'],
    ['app', 'repo', 'Better checked with the App'],
    ['neither', 'app', "Usually can't be shown by an app or code"],
    ['neither', 'repo', "Usually can't be shown by an app or code"],
    ['app', 'app', null],
    ['code', 'repo', null],
    ['both', 'app', null],
    ['both', 'repo', null],
  ] as const)('a %s item on the %s source hints %s', (kind, source, hint) => {
    expect(betterSourceHint(kind, source)).toBe(hint)
  })
})
