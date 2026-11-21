import { describe, expect, it } from 'vitest'
import { contentWords, rankPages, relevance, type RankablePage } from '../../../../src/features/evidence/appRelevance.js'
import type { Passage } from '../../../../src/features/evidence/types.js'

const passage = (id: string, text: string): Passage => ({ id, pageId: 'p', position: 1, kind: 'text', text })
const page = (pageId: string, texts: string[], accountKey = 'teen'): RankablePage => ({ pageId, accountKey, passages: texts.map((t, i) => passage(`${pageId}-${i}`, t)) })

describe('contentWords and relevance', () => {
  it('drops filler words and stems endings, so tag and tagging meet', () => {
    const words = contentWords('Can other people tag the Teen 15 account?')
    expect(words.has('tag')).toBe(true)
    expect(words.has('people')).toBe(false)
    expect(relevance(words, 'Who can tagging you: Everyone, Nobody')).toBe(1)
  })

  it('counts each item word once, whatever the page repeats', () => {
    expect(relevance(contentWords('hide birthday'), 'birthday birthday birthday')).toBe(1)
  })

  it('matches visible with visibility by their first letters', () => {
    expect(relevance(contentWords('who can see posts visibility'), 'Post visibility: Public')).toBeGreaterThanOrEqual(1)
  })

  it('scores a page with none of the words as 0', () => {
    expect(relevance(contentWords('quiet mode'), 'Change password. Delete account.')).toBe(0)
  })
})

describe('rankPages', () => {
  it('puts the page that holds the item wording before newer pages that do not', () => {
    const ranked = rankPages('Can other people tag the Teen 15 account?', [
      page('contact', ['Who can tag you: Everyone / Nobody']),
      page('home', ['Home timeline']),
      page('notfound', ['Not found']),
    ])
    expect(ranked.map((p) => p.pageId)).toEqual(['contact', 'notfound', 'home'])
  })

  it('keeps pages the AI named as evidence first', () => {
    const ranked = rankPages('tag', [page('contact', ['tag settings']), page('other', ['nothing'])], ['other'])
    expect(ranked[0]?.pageId).toBe('other')
  })

  it('drops a page with the same text as a newer page of the same account, but not another account', () => {
    const ranked = rankPages('tag', [page('old', ['Not found'], 'teen'), page('adult', ['Not found'], 'adult'), page('new', ['Not found'], 'teen')])
    expect(ranked.map((p) => p.pageId).sort()).toEqual(['adult', 'new'])
  })

  it('orders the passages inside a page by relevance, the most relevant first', () => {
    const [first] = rankPages('hide birthday', [page('contact', ['Save', 'Who can see your birthday: No one'])])
    expect(first?.passages.map((p) => p.id)).toEqual(['contact-1', 'contact-0'])
  })

  it('counts a word that few pages hold for more than one every page holds', () => {
    const everywhere = ['Teen 15 home', 'Teen 15 feed', 'Teen 15 inbox', 'Teen 15 search']
    const ranked = rankPages('Can other people tag the Teen account?', [
      page('contact', ['Teen 15 settings. Who can tag you: Everyone / Nobody']),
      ...everywhere.map((text, i) => page(`other${i}`, [text])),
    ])
    expect(ranked[0]?.pageId).toBe('contact')
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0)
  })

  it('gives a page no score when it holds none of the item words', () => {
    expect(rankPages('quiet mode', [page('a', ['Change password'])])[0]?.score).toBe(0)
  })

  it('returns nothing for no pages', () => {
    expect(rankPages('tag', [])).toEqual([])
  })
})
