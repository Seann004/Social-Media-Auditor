import { describe, expect, it } from 'vitest'
import { withoutChrome } from '../../../../src/features/evidence/appChrome.js'
import type { RankablePage } from '../../../../src/features/evidence/appRelevance.js'
import type { Passage } from '../../../../src/features/evidence/types.js'

const MENU_TEXT = 'Skip to content Back to Mastodon Profile Privacy and reach Preferences Posting defaults Log out'
const MENU_LINES = ['link "Skip to content"', 'link "Back to Mastodon"', 'link "Profile"', 'link "Privacy and reach"', 'link "Preferences"', 'link "Posting defaults"', 'link "Log out"']

let next = 0
function passage(pageId: string, position: number, kind: 'text' | 'controls', text: string): Passage {
  next += 1
  return { id: `p${next}`, pageId, position, kind, text } as Passage
}

function controls(pageId: string, own: string[]): Passage {
  const lines = [...MENU_LINES, ...own].map((line, i) => `e${i + 1} ${line}`)
  return passage(pageId, 2, 'controls', lines.join('\n'))
}

function settingsPage(pageId: string, ownText: string, own: string[], accountKey = 'teen'): RankablePage {
  return { pageId, accountKey, passages: [passage(pageId, 1, 'text', `${MENU_TEXT} ${ownText}`), controls(pageId, own)] }
}

const PAGES = (): RankablePage[] => [
  settingsPage('privacy', 'Privacy and reach Automatically accept new followers', ['checkbox "Automatically accept new followers" [on]']),
  settingsPage('posting', 'Posting defaults Posting visibility Who can quote', ['combobox "Posting visibility" [value: Public]', 'button "Save changes"']),
  settingsPage('export', 'Export You block 0 You mute 0', ['link "CSV"']),
  settingsPage('profile', 'Profile Display name', ['button "Add bio"']),
]

const textOf = (pages: RankablePage[], pageId: string, kind: 'text' | 'controls'): string =>
  pages.find((p) => p.pageId === pageId)?.passages.find((p) => p.kind === kind)?.text ?? ''

describe('withoutChrome', () => {
  it('drops the menu lines every page repeats from the controls, keeping each page own controls', () => {
    const out = withoutChrome(PAGES())

    const posting = textOf(out, 'posting', 'controls')
    expect(posting).toContain('combobox "Posting visibility" [value: Public]')
    expect(posting).toContain('button "Save changes"')
    expect(posting).not.toContain('link "Privacy and reach"')
    expect(posting).not.toContain('link "Log out"')
  })

  it('drops the menu from the start of each page text, leaving the page own words, the same words of its heading included', () => {
    const out = withoutChrome(PAGES())

    expect(textOf(out, 'posting', 'text')).toBe('Posting defaults Posting visibility Who can quote')
    expect(textOf(out, 'export', 'text')).toBe('Export You block 0 You mute 0')
  })

  it('never drops a control that shows a state or a value, even when every page repeats it', () => {
    const pages = PAGES().map((page) => ({
      ...page,
      passages: page.passages.map((p) => (p.kind === 'controls' ? { ...p, text: `${p.text}\ne99 switch "Dark mode" [on]` } : p)),
    }))

    const out = withoutChrome(pages)

    for (const id of ['privacy', 'posting', 'export', 'profile']) expect(textOf(out, id, 'controls')).toContain('switch "Dark mode" [on]')
  })

  it('leaves the pages as they are when there are too few different pages to tell a menu', () => {
    const two = PAGES().slice(0, 2)

    expect(withoutChrome(two)).toEqual(two)
  })

  it('counts a page seen many times once, so its own controls are not taken for a menu', () => {
    const repeated = settingsPage('posting', 'Posting defaults Posting visibility', ['combobox "Posting visibility" [value: Public]', 'link "Language list"'])
    const pages = [
      ...PAGES(),
      ...[1, 2, 3, 4, 5].map((n) => ({ ...repeated, pageId: `posting-${n}`, passages: repeated.passages.map((p) => ({ ...p, id: `${p.id}-${n}`, pageId: `posting-${n}` })) })),
    ]

    const out = withoutChrome(pages)

    expect(textOf(out, 'posting-1', 'controls')).toContain('link "Language list"')
  })

  it('drops a controls passage left empty, and does not change the pages it was given', () => {
    const pages = [...PAGES(), settingsPage('menu-only', '', [])]
    const before = structuredClone(pages)

    const out = withoutChrome(pages)

    expect(out.find((p) => p.pageId === 'menu-only')?.passages.some((p) => p.kind === 'controls')).toBe(false)
    expect(pages).toEqual(before)
  })
})
