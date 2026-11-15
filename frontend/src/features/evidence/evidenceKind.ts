// Which source can answer a checklist item: a pure, keyword-based suggestion. Advice only: it never
// blocks a pick or a run, and nothing about it is stored.

export type EvidenceKind = 'app' | 'code' | 'both' | 'neither'
/** The sources the kind is shown for: the App and the Code repository. */
export type CheckSource = 'app' | 'repo'

export interface EvidenceKindInput {
  text: string
  itemName?: string
  category?: string
  helpText?: string
}

export interface EvidenceKindSuggestion {
  kind: EvidenceKind
  reason: string
}

// Each entry is a word or phrase, matched as whole words in any case. A few use a small pattern,
// such as `polic(?:y|ies)` or `cent(?:re|er)`; every entry also accepts the endings below.

/** Endings accepted after every word or phrase, so "setting" also finds "settings" and "encrypt" finds "encrypted". */
const ENDING = '(?:s|es|d|ed|ing)?'
/** Things a person does in an app, after "can" or "cannot": "teens can block", "adults cannot send". */
const IN_APP_ACTION =
  '(?:see|view|find|send|receive|message|follow|report|block|mute|turn|change|edit|delete|download|post|share|comment|tag|mention|link|join|add|go live|stream|chat|call|search|like|hide|choose|set|upload)'

/** Policy, process and organisation words: what an app or code cannot show. */
const POLICY: readonly string[] = [
  // Documents and published information.
  'polic(?:y|ies)',
  'terms of (?:service|use)',
  'terms and conditions',
  'community guidelines',
  'code of conduct',
  'documented',
  'publish',
  'transparency report',
  'guidance',
  'explain',
  '(?:safety|help) cent(?:re|er)',
  // Processes and reviews ("process" as a noun: "processed" and "processing" are about data).
  'procedure',
  'process(?!ed|ing)',
  'launch',
  'appeal',
  'appeal process',
  'review process',
  '(?:risk|impact) assessment',
  'audit',
  'governance',
  // People and the organisation.
  'staff',
  'employee',
  'team',
  'moderator',
  'training',
  'trained',
  'accountable',
  'accountability',
  'senior manager',
  // Time cycles. (A time limit such as "within 30 days" is left out: it fits a response time and a
  // retention period alike.)
  'annual',
  'annually',
  'yearly',
  'every year',
  // Outside bodies.
  'regulator',
  'law enforcement',
  'police',
  'authorities',
  'hotline',
]

/** Strong words name a concrete behaviour or build detail and outrank policy words; weak words do not. */
interface WordList {
  strong: readonly string[]
  weak: readonly string[]
}

/** Something a signed-in user can see or change. */
const APP: WordList = {
  strong: [
    'toggle',
    'block',
    'mute',
    'report button',
    'can message',
    'can follow',
    'opt(?:s|ed)?[- ](?:out|in)',
    'turn(?:s|ed)?(?: it| them)? (?:on|off)',
    'switch(?:es|ed)?(?: it| them)? (?:on|off)',
    '(?:in|from|within) the app',
    'in[- ]app',
    'autoplay',
    'search results',
  ],
  weak: [
    'default',
    'setting',
    'private',
    'public',
    'visible',
    'visibility',
    'hid(?:e|den)',
    'show(?:n)?',
    'appear',
    'notification',
    'notified',
    'reminder',
    'sign(?:s|ed)?[- ]?up',
    'suggest',
    'recommend',
    'warning',
    'prompt',
    'the app',
    // Parts of the app's screens.
    'button',
    'menu',
    'screen',
    'inbox',
    'folder',
    'feed',
    `(?:can|cannot|can't|can not|are able to|is able to) ${IN_APP_ACTION}`,
  ],
}

/** How the service is built: only the code shows it. */
const CODE: WordList = {
  strong: [
    'age check',
    'age gate',
    'age verification',
    'age assurance',
    'age estimation',
    'verify age',
    'date of birth',
    'birth date',
    'birthday',
    'encrypt',
    'encryption',
    'hash',
    'rate limit',
    'audit log',
    'consent record',
    'timestamp',
    'plain text',
    // Concrete parts of the build.
    'server',
    'database',
    'api',
    'endpoint',
    'metadata',
    'token',
    'cookie',
    'scan',
  ],
  weak: [
    'session',
    'expire',
    'store',
    'storing',
    'storage',
    'retention',
    'retain',
    'kept for',
    'deleted after',
    'log',
    'record',
    'data',
    'collect',
    'third[- ]part(?:y|ies)',
  ],
}

interface Match {
  word: string
  index: number
}

const patterns = new Map<string, RegExp>()
function patternOf(entry: string): RegExp {
  const known = patterns.get(entry)
  if (known) return known
  // A final consonant may double before an ending: "scan" finds "scanned", "log" finds "logged".
  const doubled = /[bcdfgklmnprstvz]$/.test(entry) ? `(?:${entry.slice(-1)})?` : ''
  const pattern = new RegExp(`\\b(?:${entry})${doubled}${ENDING}\\b`, 'i')
  patterns.set(entry, pattern)
  return pattern
}

/** The match that comes first in the text; on a tie, the earlier entry in the list. */
function firstMatch(text: string, entries: readonly string[]): Match | null {
  let best: Match | null = null
  for (const entry of entries) {
    const found = patternOf(entry).exec(text)
    if (found && (best === null || found.index < best.index)) best = { word: found[0].toLowerCase(), index: found.index }
  }
  return best
}

function earliest(a: Match | null, b: Match | null): Match | null {
  if (a === null) return b
  if (b === null) return a
  return b.index < a.index ? b : a
}

type Found = { kind: 'neither' | 'app' | 'code'; word: string } | { kind: 'both'; appWord: string; codeWord: string }

/**
 * The rules, in order:
 * 1. A policy or process word, with no strong app or code word, makes the item `neither`. Weak words
 *    such as "setting" or "store" do not overrule it, because policies talk about settings and storage too.
 * 2. Otherwise app words and code words decide (strong and weak alike): both lists `both`, one list that kind.
 * 3. Nothing matched: null, and the caller tries the help text and category, then falls back to `both`.
 */
function classify(text: string): Found | null {
  const policy = firstMatch(text, POLICY)
  const strongApp = firstMatch(text, APP.strong)
  const strongCode = firstMatch(text, CODE.strong)
  if (policy && !strongApp && !strongCode) return { kind: 'neither', word: policy.word }
  const app = earliest(strongApp, firstMatch(text, APP.weak))
  const code = earliest(strongCode, firstMatch(text, CODE.weak))
  if (app && code) return { kind: 'both', appWord: app.word, codeWord: code.word }
  if (app) return { kind: 'app', word: app.word }
  if (code) return { kind: 'code', word: code.word }
  return null
}

const NO_MATCH_REASON = 'No word points to one source, so either may help.'

const SINGLE_REASON: Readonly<Record<'neither' | 'app' | 'code', string>> = {
  neither: 'It is a policy or process item',
  app: 'It is about something a user can see or change in the app',
  code: 'It is about how the service is built',
}

function toSuggestion(found: Found, fromContext: boolean): EvidenceKindSuggestion {
  if (found.kind === 'both') {
    const subject = fromContext ? 'Its category or help text' : 'It'
    return {
      kind: 'both',
      reason: `${subject} mentions something a user can see in the app (“${found.appWord}”) and something only the code shows (“${found.codeWord}”).`,
    }
  }
  const where = fromContext ? 'its category or help text mentions' : 'it mentions'
  return { kind: found.kind, reason: `${SINGLE_REASON[found.kind]} (${where} “${found.word}”).` }
}

const normalise = (parts: readonly (string | undefined)[]): string =>
  parts
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')

/**
 * The source that can most likely answer a checklist item, with the reason. The item's own name and
 * text decide; its help text and category are read only when those match nothing. An item that
 * matches nothing is `both`: never `neither` without a word that says so.
 */
export function suggestEvidenceKind(item: EvidenceKindInput): EvidenceKindSuggestion {
  const own = classify(normalise([item.itemName, item.text]))
  if (own) return toSuggestion(own, false)
  const context = classify(normalise([item.helpText, item.category]))
  if (context) return toSuggestion(context, true)
  return { kind: 'both', reason: NO_MATCH_REASON }
}

/** The chip shown beside an item in the picker. */
export const KIND_LABEL: Readonly<Record<EvidenceKind, string>> = {
  app: 'App',
  code: 'Code',
  both: 'App + Code',
  neither: 'Policy / process',
}

/** Whether the source is one the kind suits. */
export function fitsSource(kind: EvidenceKind, source: CheckSource): boolean {
  if (kind === 'both') return true
  if (kind === 'neither') return false
  return (kind === 'app') === (source === 'app')
}

/** The muted line under an item that suits another source, or null when the source suits it. */
export function betterSourceHint(kind: EvidenceKind, source: CheckSource): string | null {
  if (fitsSource(kind, source)) return null
  if (kind === 'neither') return "Usually can't be shown by an app or code"
  return kind === 'code' ? 'Better checked with Code' : 'Better checked with the App'
}
