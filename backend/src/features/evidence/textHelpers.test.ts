import { describe, it, expect } from 'vitest'
import { splitIntoPassages, extractControlLines } from './passages.js'
import { isQuoteVerified, normaliseForMatch } from './quotes.js'
import { classifyAccess } from './access.js'

type AccessInput = Parameters<typeof classifyAccess>[0]

const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
const longArticle = words(400)

function access(overrides: Partial<AccessInput> = {}) {
  return classifyAccess({
    httpStatus: 200,
    finalUrl: 'https://example.com/privacy',
    title: 'Privacy policy',
    text: longArticle,
    hasPasswordField: false,
    timedOut: false,
    navigationError: false,
    ...overrides,
  })
}

describe('splitIntoPassages', () => {
  it('splits on paragraphs and sentences, never exceeding maxWords except for a single longer sentence', () => {
    const sentence = (n: number) => `${words(n)}.`
    const text = `${sentence(6)} ${sentence(6)}\n\n${sentence(6)}\n\n${sentence(30)}`
    const passages = splitIntoPassages(text, 10)
    expect(passages.length).toBeGreaterThan(1)
    for (const p of passages) {
      const count = p.split(/\s+/).length
      if (count > 10) expect(count).toBe(30)
    }
    expect(passages.join(' ').split(/\s+/).length).toBe(48)
  })

  it('returns [] for empty or whitespace-only text', () => {
    expect(splitIntoPassages('  \n ')).toEqual([])
  })

  it('keeps short text as one passage', () => {
    expect(splitIntoPassages('Hello there. General Kenobi.')).toEqual(['Hello there. General Kenobi.'])
  })
})

describe('extractControlLines', () => {
  it('keeps only checkbox, switch, radio, combobox lines with their state', () => {
    expect(
      extractControlLines('- heading "Settings"\n- checkbox "Private account" [checked]\n- link "Help"'),
    ).toBe('checkbox "Private account" [checked]')
  })

  it('keeps all four control kinds, one per line', () => {
    const out = extractControlLines(
      '  - switch "Dark" [checked]\n  - radio "A"\n  - combobox "Age": 13\n  - button "Save"',
    )
    expect(out).toBe('switch "Dark" [checked]\nradio "A"\ncombobox "Age": 13')
  })
})

describe('isQuoteVerified', () => {
  it('verifies across spacing and curly-quote differences', () => {
    expect(isQuoteVerified('users’ data  is kept', "Our users' data is kept safe.")).toBe(true)
  })
  it('is case sensitive', () => {
    expect(isQuoteVerified('Users data is kept', 'users data is kept')).toBe(false)
  })
  it('rejects quotes shorter than 3 words', () => {
    expect(isQuoteVerified('the', 'the policy')).toBe(false)
  })
  it('rejects a quote that ends mid-word', () => {
    expect(isQuoteVerified('we do not', 'We... we do nothing about it')).toBe(false)
    expect(isQuoteVerified('users share data', 'users share database')).toBe(false)
  })
  it('rejects a quote that starts mid-word', () => {
    expect(isQuoteVerified('ata is kept', 'data is kept')).toBe(false)
  })
  it('accepts a quote followed by punctuation', () => {
    expect(isQuoteVerified('data is kept', 'data is kept.')).toBe(true)
  })
  it('finds a later valid match after a mid-word first hit', () => {
    expect(isQuoteVerified('we do not', 'we do nothing. we do not share')).toBe(true)
  })
  it('rejects punctuation-only quotes', () => {
    expect(isQuoteVerified('... ... ...', 'wait ... ... ... what')).toBe(false)
    expect(isQuoteVerified('- - -', 'a - - - b')).toBe(false)
  })
  it('rejects text not in the passage', () => {
    expect(isQuoteVerified('we verify every age', 'no such text')).toBe(false)
  })
})

describe('normaliseForMatch', () => {
  it('maps curly quotes and dashes, collapses whitespace, keeps case', () => {
    expect(normaliseForMatch('“A”  –  B\n\tC’s')).toBe('"A" - B C\'s')
  })
  it('is self-contained so it can be serialised into the browser', () => {
    const rebuilt = new Function(`return (${normaliseForMatch.toString()})`)()
    expect(rebuilt('“x”  y')).toBe('"x" y')
  })
})

describe('classifyAccess', () => {
  it.each<[Partial<AccessInput>, string]>([
    [{}, 'ok'],
    [{ httpStatus: 500 }, 'error'],
    [{ navigationError: true, httpStatus: null }, 'error'],
    [{ httpStatus: 403 }, 'blocked'],
    [{ timedOut: true }, 'timeout'],
    [{ finalUrl: 'https://x.com/accounts/login?next=/settings' }, 'login_required'],
    [{ hasPasswordField: true, text: 'Log in Password' }, 'login_required'],
    [{ title: 'Just a moment...', text: 'Verify you are human' }, 'blocked'],
    [{ hasPasswordField: true, text: longArticle }, 'ok'],
  ])('classifies %j as %s', (overrides, expected) => {
    expect(access(overrides).status).toBe(expected)
  })

  it('gives a detail for non-ok results and null for ok', () => {
    expect(access().detail).toBeNull()
    expect(access({ httpStatus: 500 }).detail).toContain('500')
  })
})
