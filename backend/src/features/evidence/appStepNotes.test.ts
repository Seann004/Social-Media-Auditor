import { describe, expect, it } from 'vitest'
import { SECRET_PLACEHOLDER } from './appSecrets.js'
import { errorPageNote, newMessageOf, pageDetail } from './appStepNotes.js'
import type { AppView } from './appTypes.js'

const view = (text: string, url = 'http://app.test/login'): AppView => ({ url, title: 'T', text, elements: [], frameUrls: [], hasPasswordField: false })

// The view's text is the page's innerText normalised: blocks are joined by single spaces.
describe('newMessageOf', () => {
  it('finds the text the page gained, between what stayed the same', () => {
    const before = view('Social Share moments with friends. Username Password Sign in Social, a test app.')
    const after = view('Social Share moments with friends. Username Password Sign in Invalid e-mail address or password. Social, a test app.')
    expect(newMessageOf(before, after)).toBe('Invalid e-mail address or password.')
  })

  it('finds a message that replaced another one', () => {
    expect(newMessageOf(view('Sign in Wrong password Help'), view('Sign in Too many attempts, wait a minute Help'))).toBe('Too many attempts, wait a minute')
  })

  it('finds nothing when nothing new was shown', () => {
    expect(newMessageOf(view('Social Hello'), view('Social Hello'))).toBeNull()
    expect(newMessageOf(view('Social Hello there'), view('Social Hello'))).toBeNull()
  })

  it('a change with no words is not a message', () => {
    expect(newMessageOf(view('Cart 1 item'), view('Cart 2 item'))).toBeNull()
  })

  it('a whole new page of content at the same address is not a message', () => {
    const content = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    expect(newMessageOf(view('Sign in Username Password'), view(content))).toBeNull()
  })

  it('a short page that replaced most of the old one is new content, not a message', () => {
    const signInPage = view('Social Share moments with friends. Username Password Show password Sign in Social, a test app.')
    expect(newMessageOf(signInPage, view('Settings Messages Profile Help centre @stranger Anyone up for the game tonight?'))).toBeNull()
  })

  it('cuts a long message to about 100 characters', () => {
    const long = `Error: ${'a long explanation '.repeat(8).trim()}`
    const found = newMessageOf(view('Home Help'), view(`Home ${long} Help`))!
    expect(found.length).toBeLessThanOrEqual(101)
    expect(found.endsWith('…')).toBe(true)
  })

  it('drops the message when it holds a secret, so a typed password or login never reaches a line', () => {
    expect(newMessageOf(view('Home'), view(`Home No account for ${SECRET_PLACEHOLDER}`))).toBeNull()
    expect(newMessageOf(view('Home'), view('Home See https://x.test/?token=redacted'))).toBeNull()
  })

  it('drops a message that repeats any text the AI typed in the check', () => {
    expect(newMessageOf(view('Search'), view('Search Results for private accounts'), ['private accounts'])).toBeNull()
    expect(newMessageOf(view('Feed Help'), view('Feed Your post: Hello Teen Help'), ['other', 'hello teen'])).toBeNull()
    expect(newMessageOf(view('Feed Help'), view('Feed Post shared Help'), ['hello teen'])).toBe('Post shared')
  })
})

describe('errorPageNote', () => {
  it.each([
    ['Not found.', 'Not found'],
    ['404 This page could not be found', '404'],
    ['Page not found', 'Page not found'],
    ['FORBIDDEN', 'FORBIDDEN'],
    ['Access denied: ask the owner', 'Access denied'],
  ])('names the error a page opens with: %s', (text, said) => {
    expect(errorPageNote(view(text))).toBe(said)
  })

  it('says nothing for an ordinary page, or an error word later on', () => {
    expect(errorPageNote(view('Settings Private account'))).toBeNull()
    expect(errorPageNote(view('Help What does Not found mean?'))).toBeNull()
    expect(errorPageNote(view('404s explained'))).toBeNull()
  })
})

describe('pageDetail', () => {
  it('a page that stayed and gained a message says what it now shows', () => {
    const before = view('Sign in Help')
    const after = view('Sign in Wrong password Help')
    expect(pageDetail(before, after, after.url)).toBe('page unchanged, now showing: "Wrong password"')
  })

  it('a page that stayed with nothing new is only unchanged', () => {
    expect(pageDetail(view('Sign in'), view('Sign in'), 'http://app.test/login')).toBe('page unchanged')
  })

  it('a new page that says it was not found says so', () => {
    const after = view('Not found.', 'http://app.test/nope')
    expect(pageDetail(view('Home', 'http://app.test/home'), after, after.url)).toBe('page /nope opened, but it said "Not found"')
  })

  it('an ordinary new page, or one that could not be read, is only opened', () => {
    expect(pageDetail(view('Home', 'http://app.test/home'), view('Settings', 'http://app.test/settings'), 'http://app.test/settings')).toBe('page /settings opened')
    expect(pageDetail(view('Home', 'http://app.test/home'), null, 'http://app.test/settings')).toBe('page /settings opened')
    expect(pageDetail(null, null, 'http://app.test/home')).toBe('page /home opened')
  })
})
