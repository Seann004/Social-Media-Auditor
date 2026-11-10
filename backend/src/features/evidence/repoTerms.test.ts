import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssessItem } from './assess.js'
import { REPO_MAX_MORE_TERMS, REPO_MAX_SEARCH_WORDS, REPO_PROMPT_PATHS_CHARS } from './config.js'
import { askMoreTerms, askSearchTerms, fallbackTerms } from './repoTerms.js'

const ITEM: AssessItem = {
  id: 'i1',
  guidelineId: 'g1',
  category: 'Privacy',
  name: 'Private teen accounts',
  text: 'Are the accounts of users under 18 private by default?',
  helpText: null,
}
const OTHER: AssessItem = { ...ITEM, id: 'i2', name: null, text: 'Can users report abuse from posts?' }

function reply(content: unknown, total = 100): Response {
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { total_tokens: total } }))
}

function stubFetch(content: unknown, total = 100) {
  const f = vi.fn().mockImplementation(async () => reply(content, total))
  vi.stubGlobal('fetch', f)
  return f
}

const sentUser = (f: ReturnType<typeof vi.fn>, call = 0) => {
  const body = JSON.parse((f.mock.calls[call][1] as RequestInit).body as string)
  const user = body.messages[1].content as string
  return JSON.parse(user.slice(user.indexOf('{'))) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fallbackTerms', () => {
  it('uses the words of the name and text, lower case, 3+ letters, no common words', () => {
    const terms = fallbackTerms(ITEM)
    expect(terms.words).toEqual(['private', 'teen', 'accounts', 'users', 'under', 'default'])
    expect(terms.pathHints).toEqual([])
    expect(terms.paths).toEqual([])
  })
  it('keeps at most REPO_MAX_SEARCH_WORDS words', () => {
    const long = { ...ITEM, name: null, text: Array.from({ length: 30 }, (_, i) => `word${i}x`).join(' ') }
    expect(fallbackTerms(long).words).toHaveLength(REPO_MAX_SEARCH_WORDS)
  })
})

describe('askSearchTerms', () => {
  it('makes one call, drops bad words and keeps the good ones', async () => {
    const f = stubFetch(
      {
        items: [
          { itemId: 'i1', words: ['isPrivate', 'a b; c', 'x', 'age_check', 'teen-mode', 'y'.repeat(41)], pathHints: ['settings', 'bad hint!'] },
          { itemId: 'i2', words: ['report'], pathHints: [] },
        ],
      },
      77,
    )
    const out = await askSearchTerms({ items: [ITEM, OTHER], platform: 'P', paths: ['src/a.ts'], apiKey: 'K', model: 'm' })
    expect(f).toHaveBeenCalledTimes(1)
    expect(out.tokensUsed).toBe(77)
    expect(out.terms.get('i1')).toEqual({ words: ['isPrivate', 'age_check', 'teen-mode'], pathHints: ['settings'], paths: [] })
    expect(out.terms.get('i2')).toEqual({ words: ['report'], pathHints: [], paths: [] })
  })

  it('caps words and path hints', async () => {
    stubFetch({
      items: [{ itemId: 'i1', words: Array.from({ length: 20 }, (_, i) => `w${i}x`), pathHints: Array.from({ length: 10 }, (_, i) => `h${i}x`) }],
    })
    const out = await askSearchTerms({ items: [ITEM], platform: 'P', paths: [], apiKey: 'K', model: 'm' })
    expect(out.terms.get('i1')?.words).toHaveLength(REPO_MAX_SEARCH_WORDS)
    expect(out.terms.get('i1')?.pathHints.length).toBeLessThanOrEqual(6)
  })

  it('gives an item the AI left out its fallbackTerms', async () => {
    stubFetch({ items: [{ itemId: 'i2', words: ['report'], pathHints: [] }] })
    const out = await askSearchTerms({ items: [ITEM, OTHER], platform: 'P', paths: [], apiKey: 'K', model: 'm' })
    expect(out.terms.get('i1')).toEqual(fallbackTerms(ITEM))
  })

  it('gives every item its fallbackTerms when the reply is not JSON, and counts the tokens', async () => {
    stubFetch('not json', 40)
    const out = await askSearchTerms({ items: [ITEM, OTHER], platform: 'P', paths: [], apiKey: 'K', model: 'm' })
    expect(out.terms.get('i1')).toEqual(fallbackTerms(ITEM))
    expect(out.terms.get('i2')).toEqual(fallbackTerms(OTHER))
    expect(out.tokensUsed).toBe(40)
  })

  it('sends the paths shortest first, then alphabetical, and stops at the character cap', async () => {
    const f = stubFetch({ items: [] })
    const paths = [
      ...Array.from({ length: 400 }, (_, i) => `src/features/module${String(i).padStart(3, '0')}/index.ts`),
      'b.ts',
      'a.ts',
      'src/z.ts',
    ]
    await askSearchTerms({ items: [ITEM], platform: 'P', paths, apiKey: 'K', model: 'm' })
    const sent = sentUser(f).paths as string[]
    expect(sent.slice(0, 3)).toEqual(['a.ts', 'b.ts', 'src/z.ts'])
    expect(sent.length).toBeLessThan(paths.length)
    expect(sent.join('\n').length).toBeLessThanOrEqual(REPO_PROMPT_PATHS_CHARS)
    expect(sent[3]).toBe('src/features/module000/index.ts')
  })
})

describe('askMoreTerms', () => {
  it('drops a path that is not in the repository and caps words and paths', async () => {
    stubFetch(
      {
        words: ['minAge', 'bad word', 'birthday', 'dob', 'extra'],
        paths: ['src/age.ts', '../etc/passwd', 'src/missing.ts', 'SRC/AGE.TS', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      },
      30,
    )
    const out = await askMoreTerms({
      item: ITEM,
      platform: 'P',
      seenPaths: ['src/a.ts'],
      paths: ['src/a.ts', 'src/age.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      apiKey: 'K',
      model: 'm',
    })
    expect(out.tokensUsed).toBe(30)
    expect(out.terms.words).toEqual(['minAge', 'birthday', 'dob'])
    expect(out.terms.words.length).toBeLessThanOrEqual(REPO_MAX_MORE_TERMS)
    expect(out.terms.paths).toEqual(['src/age.ts', 'src/b.ts', 'src/c.ts'])
    expect(out.terms.pathHints).toEqual([])
  })

  it('returns no terms when the reply is not JSON', async () => {
    stubFetch('nope', 12)
    const out = await askMoreTerms({ item: ITEM, platform: 'P', seenPaths: [], paths: ['a.ts'], apiKey: 'K', model: 'm' })
    expect(out).toEqual({ terms: { words: [], pathHints: [], paths: [] }, tokensUsed: 12 })
  })
})

const sentSystem = (f: ReturnType<typeof vi.fn>, call = 0): string => {
  const body = JSON.parse((f.mock.calls[call][1] as RequestInit).body as string)
  return body.messages[0].content as string
}

describe('avoidPaths: areas of the code to rank lower', () => {
  it('askSearchTerms keeps up to 4 good avoidPaths and drops bad ones', async () => {
    stubFetch({
      items: [
        { itemId: 'i1', words: ['report'], pathHints: [], avoidPaths: ['admin', 'a', 'bad word', 'moderation', 'admin', 'x'.repeat(41), 'staff', 'mod', 'extra'] },
        { itemId: 'i2', words: ['report'], pathHints: [], avoidPaths: 'admin' },
      ],
    })
    const out = await askSearchTerms({ items: [ITEM, OTHER], platform: 'P', paths: [], apiKey: 'K', model: 'm' })
    expect(out.terms.get('i1')?.avoidPaths).toEqual(['admin', 'moderation', 'staff', 'mod'])
    // A list that is not a list is ignored, and the item's words are kept.
    expect(out.terms.get('i2')).toEqual({ words: ['report'], pathHints: [], paths: [] })
  })

  it('askMoreTerms may return avoidPaths too', async () => {
    stubFetch({ words: ['flag'], paths: [], avoidPaths: ['admin', 'not ok'] })
    const out = await askMoreTerms({ item: ITEM, platform: 'P', seenPaths: [], paths: ['a.ts'], apiKey: 'K', model: 'm' })
    expect(out.terms.avoidPaths).toEqual(['admin'])
  })

  it('fallbackTerms ranks nothing lower', () => {
    expect(fallbackTerms(ITEM).avoidPaths ?? []).toEqual([])
  })
})

describe('the search-terms prompts', () => {
  it('asks for at least 8 varied words, user-facing path hints and avoidPaths left empty for staff items', async () => {
    const f = stubFetch({ items: [] })
    await askSearchTerms({ items: [ITEM], platform: 'P', paths: [], apiKey: 'K', model: 'm' })
    const system = sentSystem(f)
    expect(system).toMatch(/at least 8/i)
    expect(system).toMatch(/synonyms/i)
    expect(system).toContain('report, flag, abuse, complain, block, mute')
    for (const layer of ['controllers', 'api', 'models', 'policies', 'services', 'views']) expect(system).toContain(`"${layer}"`)
    expect(system).toMatch(/not .*staff tooling/i)
    expect(system).toContain('"avoidPaths"')
    expect(system).toMatch(/up to 4/)
    expect(system).toMatch(/"admin", "moderation", "staff"/)
    expect(system).toMatch(/leave "avoidPaths" empty when the item is about/i)
    expect(system).toContain('"avoidPaths":["..."]')
  })

  it('round 2 asks to look in a different part of the code than the seen paths, and may give avoidPaths', async () => {
    const f = stubFetch({ words: [], paths: [] })
    await askMoreTerms({ item: ITEM, platform: 'P', seenPaths: ['app/admin/a.rb'], paths: ['a.ts'], apiKey: 'K', model: 'm' })
    const system = sentSystem(f)
    expect(system).toMatch(/DIFFERENT part of the code than the "seenPaths"/)
    expect(system).toContain('"avoidPaths"')
    expect(system).toMatch(/leave "avoidPaths" empty when the item is about/i)
  })
})
