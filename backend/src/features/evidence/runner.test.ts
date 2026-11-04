import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  answer,
  createWorld,
  DEFAULT_ITEMS,
  loginPage,
  okPage,
  page,
  PROJECT,
  quoteFirstPassage,
  SENTENCE,
} from './__fixtures__/runnerWorld.js'
import type { AssessedItem } from './assess.js'
import { MAX_HIGHLIGHTS_PER_SUGGESTION } from './config.js'
import { createMemoryRepository } from './memoryRepository.js'
import { runEvidenceJob } from './runner.js'

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  })
})

afterEach(() => vi.restoreAllMocks())

describe('runEvidenceJob', () => {
  it('captures, stores passages and screenshots, assesses, and ends completed', async () => {
    const world = await createWorld({ pages: [okPage(), loginPage()] })

    const run = await world.run()

    expect(run.status).toBe('completed')
    expect(run.error).toBeNull()
    expect(run.model).toBe('test-model')
    expect(run.categoriesTotal).toBe(2)
    expect(run.categoriesDone).toBe(2)
    expect(run.unassessedCategories).toEqual([])
    expect(run.pagesDone).toBe(2)
    expect(run.tokensUsed).toBe(200)
    expect(run.startedAt).not.toBeNull()
    expect(run.finishedAt).not.toBeNull()

    const pages = await world.repo.listPages(run.id)
    expect(pages.map((p) => p.accessStatus).sort()).toEqual(['login_required', 'ok'])
    for (const p of pages) {
      expect(p.screenshotPath?.startsWith(`${PROJECT}/`)).toBe(true)
      await expect(world.repo.signedUrl(p.screenshotPath as string, 60)).resolves.toContain(p.screenshotPath as string)
    }
    // Text of a login page is kept for the auditor but never reaches the AI.
    const login = pages.find((p) => p.accessStatus === 'login_required')
    expect(login?.text).toContain('Log in')
    const passages = await world.repo.searchPassages(run.id, 'teen accounts private report abuse log in', 50)
    expect(passages.length).toBeGreaterThan(0)
    expect(passages.every((p) => p.pageId !== login?.id)).toBe(true)
    for (const call of world.calls.assess) expect(call.passages.every((p) => p.pageId !== login?.id)).toBe(true)
  })

  it('stores a suggestion per item with flags and verified quotes, and writes NO answers', async () => {
    const world = await createWorld({ answers: [] })

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    expect(suggestions.map((s) => s.itemId).sort()).toEqual(['i1', 'i2', 'i3'])
    for (const s of suggestions) {
      expect(s.suggestedResult).toBe('yes')
      expect(s.quotes).toHaveLength(1)
      expect(s.quotes[0].verified).toBe(true)
      expect(s.quotes[0].pageId).not.toBeNull()
      expect(s.flags).toEqual([])
    }
    expect(world.audit.applyAnswer).not.toHaveBeenCalled()
    expect(await world.repo.listDecisions(PROJECT)).toEqual([])
    expect(world.audit.answers).toEqual([])
  })

  it('marks a made-up quote unverified and flags it', async () => {
    const world = await createWorld({
      assess: (input) => {
        const real = input.passages[0]
        const results: AssessedItem[] = input.items.map((it, i) => ({
          itemId: it.id,
          suggestedResult: 'yes',
          reason: 'r',
          quotes:
            i === 0
              ? [{ passageId: real.id, text: 'We never store any data about children at all.' }]
              : [{ passageId: null, text: SENTENCE }],
          evidenceSufficient: true,
          conflicting: false,
          webAssessable: true,
          confidence: 'high',
        }))
        return { results, missingItemIds: [], tokensUsed: 10 }
      },
    })

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    expect(suggestions.length).toBe(3)
    for (const s of suggestions) {
      expect(s.quotes).toHaveLength(1)
      expect(s.quotes[0].verified).toBe(false)
      expect(s.quotes[0].highlightScreenshotPath).toBeNull()
      expect(s.flags.map((f) => f.type)).toContain('unverified_quote')
    }
    // The quote that named no passage we sent is kept, with nothing it can point at.
    const unlinked = suggestions.filter((s) => s.quotes[0].passageId === null)
    expect(unlinked.length).toBeGreaterThan(0)
    expect(unlinked.every((s) => s.quotes[0].pageId === null)).toBe(true)
    expect(world.calls.highlights).toHaveLength(0)
  })

  it('does not verify a real sentence quoted from a different passage than the one it names', async () => {
    const world = await createWorld({
      items: [DEFAULT_ITEMS[2]],
      assess: (input) => {
        const [named, other] = input.passages
        const sentence = other.text.split(/(?<=\.)\s/)[0]
        return {
          results: input.items.map((it) => ({
            itemId: it.id,
            suggestedResult: 'yes' as const,
            reason: 'r',
            quotes: [{ passageId: named.id, text: sentence }],
            evidenceSufficient: true,
            conflicting: false,
            webAssessable: true,
            confidence: 'high' as const,
          })),
          missingItemIds: [],
          tokensUsed: 1,
        }
      },
    })

    const run = await world.run()
    const [s] = await world.suggestions(run.id)

    expect(world.calls.assess[0].passages.length).toBeGreaterThan(1)
    expect(s.quotes[0].verified).toBe(false)
    expect(s.flags.map((f) => f.type)).toContain('unverified_quote')
  })

  it('flags missing_evidence when a site has no usable text, without crashing', async () => {
    const world = await createWorld({ pages: [okPage({ text: '' })] })

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    expect(run.status).toBe('completed')
    expect(world.calls.assess).toHaveLength(0)
    expect(suggestions).toHaveLength(3)
    for (const s of suggestions) {
      expect(s.suggestedResult).toBeNull()
      expect(s.quotes).toEqual([])
      expect(s.flags.map((f) => f.type)).toContain('missing_evidence')
    }
  })

  it('names the pages that could not be captured on an item with no evidence', async () => {
    const world = await createWorld({
      items: [{ ...DEFAULT_ITEMS[0], text: 'Zebra giraffe elephant policy?' }],
      pages: [okPage(), loginPage()],
    })

    const run = await world.run()
    const [s] = await world.suggestions(run.id)

    expect(s.flags.map((f) => f.type)).toEqual(expect.arrayContaining(['missing_evidence', 'inaccessible']))
    expect(s.flags.find((f) => f.type === 'inaccessible')?.reason).toContain('https://p.test/account')
  })

  it('never names a page that was read as inaccessible', async () => {
    const readable = await createWorld({
      items: [{ ...DEFAULT_ITEMS[0], text: 'Zebra giraffe elephant policy?' }],
      pages: [okPage(), loginPage()],
    })
    const run = await readable.run()
    const [s] = await readable.suggestions(run.id)
    expect(s.flags.find((f) => f.type === 'inaccessible')?.reason).not.toContain('https://p.test/privacy')

    const allRead = await createWorld({ items: [{ ...DEFAULT_ITEMS[0], text: 'Zebra giraffe elephant policy?' }], pages: [okPage()] })
    const clean = await allRead.run()
    const [t] = await allRead.suggestions(clean.id)
    expect(t.flags.map((f) => f.type)).toEqual(['missing_evidence'])
  })

  it('sends the AI only the items that have passages, and still reports the rest as missing evidence', async () => {
    const items = [DEFAULT_ITEMS[0], { ...DEFAULT_ITEMS[1], text: 'Zebra giraffe elephant policy?' }]
    const world = await createWorld({ items })

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    expect(world.calls.assess).toHaveLength(1)
    expect(world.calls.assess[0].items.map((i) => i.id)).toEqual(['i1'])
    const bare = suggestions.find((s) => s.itemId === 'i2')
    expect(bare?.suggestedResult).toBeNull()
    expect(bare?.flags.map((f) => f.type)).toContain('missing_evidence')
  })

  it('ends failed with a clear error when every page failed, without calling the AI', async () => {
    const world = await createWorld({
      pages: [
        loginPage(),
        page('https://p.test/gone', '', { accessStatus: 'error', accessDetail: 'HTTP 500', httpStatus: 500 }),
      ],
    })

    const run = await world.run()

    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/no page|could be read|captured/i)
    expect(world.calls.assess).toHaveLength(0)
    expect(await world.repo.listPages(run.id)).toHaveLength(2)
    expect(await world.suggestions(run.id)).toEqual([])
  })

  it('ends failed when there is no source, or the source has no urls', async () => {
    const none = await createWorld({ startUrls: null })
    expect((await none.run()).status).toBe('failed')

    const empty = await createWorld({ startUrls: [] })
    const run = await empty.run()
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/start/i)
    expect(empty.calls.capture).toHaveLength(0)
  })

  it('ends failed with a clear error when the browser cannot start', async () => {
    const world = await createWorld({
      browserProvider: async () => {
        throw new Error('spawn chromium ENOENT')
      },
    })

    const run = await world.run()

    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/browser/i)
    expect(world.calls.assess).toHaveLength(0)
  })

  it('respects robots.txt unless the Head Auditor recorded permission', async () => {
    const strict = await createWorld()
    await strict.run()
    expect(strict.calls.capture[0].respectRobots).toBe(true)

    const denied = await createWorld()
    await denied.repo.setPermission(PROJECT, false, null, 'u1')
    await denied.run()
    expect(denied.calls.capture[0].respectRobots).toBe(true)

    const granted = await createWorld()
    await granted.repo.setPermission(PROJECT, true, 'Emailed approval', 'u1')
    await granted.run()
    expect(granted.calls.capture[0].respectRobots).toBe(false)
    expect(granted.calls.capture[0].startUrls).toEqual(['https://p.test/privacy'])
  })

  it('stores a page whose screenshot cannot be saved, and carries on', async () => {
    const repo = createMemoryRepository()
    const upload = repo.upload.bind(repo)
    repo.upload = async (path, jpeg) => {
      if (!path.includes('/hl-')) throw new Error('storage is down')
      return upload(path, jpeg)
    }
    const world = await createWorld({ repo })

    const run = await world.run()

    expect(run.status).toBe('completed')
    const [stored] = await repo.listPages(run.id)
    expect(stored.screenshotPath).toBeNull()
    expect(logged.join('\n')).toMatch(/screenshot/i)
  })

  it('records categories as not assessed on a Groq outage, and invents no suggestions', async () => {
    const world = await createWorld({
      assess: () => {
        throw new Error('fetch failed')
      },
    })

    const run = await world.run()

    expect(run.status).toBe('partial')
    expect(run.categoriesDone).toBe(0)
    expect(run.unassessedCategories).toEqual(['g1__Privacy', 'g1__Reporting'])
    expect(run.error).toMatch(/2 categories/)
    expect(world.calls.assess).toHaveLength(2)
    expect(await world.suggestions(run.id)).toEqual([])
  })

  it('marks an item the AI left out as not assessed, so its category can be retried', async () => {
    const world = await createWorld({
      assess: (input) => {
        const out = quoteFirstPassage(input)
        return { ...out, results: out.results.filter((r) => r.itemId !== 'i2'), missingItemIds: ['i2'] }
      },
    })

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    expect(run.status).toBe('partial')
    expect(run.unassessedCategories).toEqual(['g1__Privacy'])
    expect(run.categoriesDone).toBe(1)
    expect(suggestions.map((s) => s.itemId).sort()).toEqual(['i1', 'i3'])
  })

  it('never puts an API key or a stack trace in the error or the log', async () => {
    const world = await createWorld({
      assess: () => {
        throw new Error('Authorization: Bearer gsk_test_secret_key rejected')
      },
    })

    const run = await world.run()

    expect(JSON.stringify(run)).not.toContain('gsk_test_secret_key')
    expect(logged.join('\n')).not.toContain('gsk_test_secret_key')
    expect(logged.join('\n')).not.toMatch(/\n\s+at /)
  })

  it('completes with nothing to do when the checklist has no items', async () => {
    const world = await createWorld({ items: [] })

    const run = await world.run()

    expect(run.status).toBe('completed')
    expect(run.categoriesTotal).toBe(0)
    expect(world.calls.assess).toHaveLength(0)
  })

  it('ends failed, without throwing, when the checklist cannot be read', async () => {
    const world = await createWorld()
    world.audit.listChecklistItems = async () => {
      throw new Error('database unreachable')
    }

    const run = await world.run()

    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/checklist/i)
  })

  it('a checklist item deleted mid-run skips that item and finishes the rest', async () => {
    const repo = createMemoryRepository()
    const world = await createWorld({ repo })
    const add = repo.addSuggestion.bind(repo)
    repo.addSuggestion = async (input) => {
      if (input.itemId === 'i2') {
        world.audit.items = world.audit.items.filter((i) => i.id !== 'i2')
        throw new Error('insert or update violates foreign key constraint')
      }
      return add(input)
    }

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    expect(run.status).toBe('completed')
    expect(suggestions.map((s) => s.itemId).sort()).toEqual(['i1', 'i3'])
    expect(run.unassessedCategories).toEqual([])
  })

  it('treats a failed insert for an item that still exists as a failure of its category', async () => {
    const repo = createMemoryRepository()
    const world = await createWorld({ repo })
    const add = repo.addSuggestion.bind(repo)
    repo.addSuggestion = async (input) => {
      if (input.itemId === 'i3') throw new Error('write failed')
      return add(input)
    }

    const run = await world.run()

    expect(run.status).toBe('partial')
    expect(run.unassessedCategories).toEqual(['g1__Reporting'])
    expect((await world.suggestions(run.id)).map((s) => s.itemId).sort()).toEqual(['i1', 'i2'])
  })

  it('a project deleted mid-run ends quietly without throwing out of the worker', async () => {
    let gone = false
    const repo = createMemoryRepository()
    const world = await createWorld({
      repo,
      assess: (input) => {
        gone = true
        return quoteFirstPassage(input)
      },
    })
    const created = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })
    const getRun = repo.getRun.bind(repo)
    const updateRun = repo.updateRun.bind(repo)
    repo.getRun = async (id) => (gone ? null : getRun(id))
    repo.updateRun = async (id, patch) => {
      if (gone) throw new Error('violates foreign key')
      return updateRun(id, patch)
    }
    repo.addSuggestion = async () => {
      throw new Error('violates foreign key')
    }

    await expect(runEvidenceJob(created.id, world.deps)).resolves.toBeUndefined()

    expect(logged).toEqual([])
    gone = false
    expect((await getRun(created.id))?.status).toBe('assessing')
  })

  it('does nothing when the run does not exist', async () => {
    const world = await createWorld()
    await expect(runEvidenceJob('no-such-run', world.deps)).resolves.toBeUndefined()
    expect(world.calls.capture).toHaveLength(0)
  })

  it('never rejects, even when the repository fails in an unexpected place', async () => {
    const repo = createMemoryRepository()
    const world = await createWorld({ repo })
    repo.getSource = async () => {
      throw new Error('boom')
    }

    const run = await world.run()

    expect(run.status).toBe('failed')
    expect(run.error).not.toMatch(/boom/)
  })
})

describe('auto-matching an existing answer', () => {
  it('auto-records accepted with origin auto_match when an existing answer equals the AI result', async () => {
    const world = await createWorld({ answers: [answer('i1', 'compliant')] })

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    const decisions = await world.repo.listDecisions(PROJECT)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      itemId: 'i1',
      suggestionId: suggestions.find((s) => s.itemId === 'i1')?.id,
      decision: 'accepted',
      origin: 'auto_match',
      userId: null,
      finalResult: 'compliant',
      overrideReason: null,
    })
    expect(world.audit.applyAnswer).not.toHaveBeenCalled()
    expect(world.audit.answers).toEqual([answer('i1', 'compliant')])
  })

  it('auto-records even when the suggestion carries flags', async () => {
    const world = await createWorld({
      answers: [answer('i1', 'compliant')],
      assess: (input) => {
        const out = quoteFirstPassage(input)
        return { ...out, results: out.results.map((r) => ({ ...r, confidence: 'low' as const })) }
      },
    })

    const run = await world.run()
    const flagged = (await world.suggestions(run.id)).find((s) => s.itemId === 'i1')

    expect(flagged?.flags.map((f) => f.type)).toContain('low_confidence')
    expect(await world.repo.listDecisions(PROJECT)).toHaveLength(1)
  })

  it('records nothing when the existing answer differs or the item already has a decision', async () => {
    const world = await createWorld({
      answers: [
        answer('i1', 'non_compliant'),
        answer('i2', 'compliant', 'u1'),
        answer('i2', 'non_compliant', 'u2'),
        answer('i3', 'compliant'),
        answer('i4', 'partially'),
        answer('i5', 'not_started'),
      ],
      items: [
        ...DEFAULT_ITEMS,
        { ...DEFAULT_ITEMS[2], id: 'i4' },
        { ...DEFAULT_ITEMS[2], id: 'i5' },
      ],
    })
    await world.repo.addDecision({
      suggestionId: 'earlier',
      projectId: PROJECT,
      itemId: 'i3',
      userId: 'u1',
      decision: 'overridden',
      finalResult: 'compliant',
      overrideReason: 'checked by hand',
      origin: 'card',
    })

    await world.run()

    const decisions = await world.repo.listDecisions(PROJECT)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ itemId: 'i3', decision: 'overridden', origin: 'card' })
  })

  it('records nothing for a suggestion with no result', async () => {
    const world = await createWorld({ answers: [answer('i1', 'compliant')], pages: [okPage({ text: '' })] })

    await world.run()

    expect(await world.repo.listDecisions(PROJECT)).toEqual([])
  })
})

describe('highlights', () => {
  const FOUR_SENTENCES =
    'Teen accounts are private by default. Teen accounts cannot receive messages from strangers. ' +
    'Teen accounts hide the follower list from the public. Teen accounts limit late night notifications.'

  const quotesOf = (text: string) => text.split(/(?<=\.)\s/)

  function assessQuoting(texts: string[]) {
    return (input: Parameters<NonNullable<Awaited<ReturnType<typeof createWorld>>['deps']['assessBatch']>>[0]) => {
      const passage = input.passages[0]
      const results: AssessedItem[] = input.items.map((it) => ({
        itemId: it.id,
        suggestedResult: 'yes' as const,
        reason: 'r',
        quotes: texts.map((t) => ({ passageId: passage.id, text: t })),
        evidenceSufficient: true,
        conflicting: false,
        webAssessable: true,
        confidence: 'high' as const,
      }))
      return { results, missingItemIds: [], tokensUsed: 5 }
    }
  }

  it('highlights only the first verified text quotes of a suggestion, once per page, in the run browser', async () => {
    const sentences = quotesOf(FOUR_SENTENCES)
    const world = await createWorld({
      items: [DEFAULT_ITEMS[0]],
      pages: [page('https://p.test/privacy', FOUR_SENTENCES, { finalUrl: 'https://p.test/final' })],
      assess: assessQuoting(['This sentence was never on the page at all.', ...sentences]),
      highlights: async (opts) => new Map(opts.quotes.map((q) => [q, Buffer.from(`img:${q}`)])),
    })

    const run = await world.run()
    const [s] = await world.suggestions(run.id)

    expect(world.calls.highlights).toHaveLength(1)
    const call = world.calls.highlights[0]
    expect(call.pageUrl).toBe('https://p.test/final')
    expect(call.quotes).toEqual(sentences.slice(0, MAX_HIGHLIGHTS_PER_SUGGESTION))
    expect(call.signal).toBeInstanceOf(AbortSignal)
    expect(world.calls.browsers).toBe(1)

    const withPath = s.quotes.filter((q) => q.highlightScreenshotPath !== null)
    expect(withPath.map((q) => q.quoteText)).toEqual(sentences.slice(0, MAX_HIGHLIGHTS_PER_SUGGESTION))
    for (const q of withPath) {
      expect(q.highlightScreenshotPath?.startsWith(`${PROJECT}/`)).toBe(true)
      await expect(world.repo.signedUrl(q.highlightScreenshotPath as string, 60)).resolves.toBeTruthy()
    }
    // Not found by the highlighter, or not a candidate: no path, and the card shows the page picture.
    expect(s.quotes.find((q) => q.quoteText === sentences[2])?.highlightScreenshotPath).toBeNull()
    expect(s.quotes.find((q) => q.quoteText.startsWith('This sentence'))?.verified).toBe(false)
  })

  it('applies the followed-link rules to the page being revisited', async () => {
    const guard = async (url: string) =>
      url.includes('blocked') ? { allowed: false as const, reason: 'private' } : { allowed: true as const }
    const world = await createWorld({ items: [DEFAULT_ITEMS[0]] })
    world.deps.guard = { check: guard }
    await world.repo.setPermission(PROJECT, true, 'Emailed approval', 'u1')

    await world.run()

    // Sub-resources get the url guard alone, as in the capture; only navigations get the site and robots rules.
    expect(world.calls.highlights[0].guard).toBe(world.deps.guard)
    const revisit = world.calls.highlights[0].navigationGuard
    expect((await revisit.check('https://p.test/privacy')).allowed).toBe(true)
    expect((await revisit.check('https://elsewhere.test/')).allowed).toBe(false)
    expect((await revisit.check('https://p.test/blocked')).allowed).toBe(false)
  })

  it('also applies robots.txt to the revisit, reading it once for the whole run', async () => {
    const fetched: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(String(url))
        return new Response('User-agent: *\nDisallow: /private', { status: 200 })
      }),
    )
    try {
      const world = await createWorld({ items: [DEFAULT_ITEMS[0]] })

      await world.run()

      const revisit = world.calls.highlights[0].navigationGuard
      expect((await revisit.check('https://p.test/privacy')).allowed).toBe(true)
      expect((await revisit.check('https://p.test/private')).allowed).toBe(false)
      expect((await revisit.check('https://p.test/privacy')).allowed).toBe(true)
      expect(fetched).toEqual(['https://p.test/robots.txt'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('leaves the path null when a quote is absent from the map, and when the upload fails', async () => {
    const repo = createMemoryRepository()
    const upload = repo.upload.bind(repo)
    repo.upload = async (path, jpeg) => {
      if (path.includes('/hl-')) throw new Error('storage is down')
      return upload(path, jpeg)
    }
    const world = await createWorld({
      repo,
      items: [DEFAULT_ITEMS[0]],
      pages: [page('https://p.test/privacy', FOUR_SENTENCES)],
      assess: assessQuoting(quotesOf(FOUR_SENTENCES).slice(0, 2)),
      highlights: async (opts) => new Map([[opts.quotes[0], Buffer.from('img')]]),
    })

    const run = await world.run()
    const [s] = await world.suggestions(run.id)

    expect(run.status).toBe('completed')
    expect(s.quotes.every((q) => q.highlightScreenshotPath === null)).toBe(true)
    expect(s.quotes.every((q) => q.verified)).toBe(true)
  })

  it('gives a quote from the controls passage no close-up', async () => {
    const world = await createWorld({
      items: [{ ...DEFAULT_ITEMS[0], text: 'Is the private account setting checked?' }],
      pages: [okPage({ text: 'Welcome to the help centre.', accessibilitySnapshot: '- checkbox "Private account" [checked]\n- heading "Settings"' })],
      assess: (input) => {
        const controls = input.passages.find((p) => p.kind === 'controls')
        if (!controls) throw new Error('the controls passage was not sent')
        return {
          results: input.items.map((it) => ({
            itemId: it.id,
            suggestedResult: 'yes' as const,
            reason: 'r',
            quotes: [{ passageId: controls.id, text: controls.text }],
            evidenceSufficient: true,
            conflicting: false,
            webAssessable: true,
            confidence: 'high' as const,
          })),
          missingItemIds: [],
          tokensUsed: 1,
        }
      },
    })

    const run = await world.run()
    const [s] = await world.suggestions(run.id)

    expect(run.status).toBe('completed')
    expect(s.quotes[0].verified).toBe(true)
    expect(s.quotes[0].highlightScreenshotPath).toBeNull()
    expect(world.calls.highlights).toHaveLength(0)
  })
})
