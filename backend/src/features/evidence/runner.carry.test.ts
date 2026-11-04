import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroqLimitError } from '../../lib/groq.js'
import { answer, createWorld, item, okPage, PROJECT, quoteFirstPassage, THREE_CATEGORIES, type World } from './__fixtures__/runnerWorld.js'
import type { AssessInput, AssessOutput } from './assess.js'
import { createMemoryRepository } from './memoryRepository.js'
import type { Suggestion } from './types.js'

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  })
})
afterEach(() => vi.restoreAllMocks())

const ids = (s: Suggestion[]) => s.map((x) => x.itemId).sort()
const withReason = (input: AssessInput, reason: string): AssessOutput => {
  const out = quoteFirstPassage(input)
  return { ...out, results: out.results.map((r) => ({ ...r, reason })) }
}
const limitAfter = (n: number, reason: string) => {
  let calls = 0
  return async (input: AssessInput): Promise<AssessOutput> => {
    calls += 1
    if (calls > n) throw new GroqLimitError(7200)
    return withReason(input, reason)
  }
}
const reasons = (s: Suggestion[]) => Object.fromEntries(s.map((x) => [x.itemId, x.reason]))

describe('which earlier run a re-assess builds on', () => {
  it('takes suggestions from the latest result run of the capture, not from the capture run itself', async () => {
    const world = await createWorld({ items: THREE_CATEGORIES, assess: (input) => withReason(input, 'run one') })
    const one = await world.run()
    expect(one.status).toBe('completed')
    // Run two redoes Privacy and is then stopped by the limit.
    world.deps.assessBatch = limitAfter(1, 'run two')
    const two = await world.run({ scope: 'all', capturedInRunId: one.id })
    expect(two.status).toBe('partial')
    expect(two.unassessedCategories).toEqual(['g1__Reporting', 'g1__Safety'])
    world.deps.assessBatch = async (input) => withReason(input, 'run three')

    const three = await world.run({ scope: 'unfinished', capturedInRunId: one.id })
    const after = await world.suggestions(three.id)

    expect(three.status).toBe('completed')
    expect(three.categoriesTotal).toBe(2)
    expect(reasons(after)).toEqual({ i1: 'run two', i2: 'run two', i3: 'run three', i4: 'run three' })
  })

  it('ignores a latest result run that came from another capture, for unfinished and for carrying', async () => {
    const world = await createWorld({ items: THREE_CATEGORIES, assess: (input) => withReason(input, 'capture A') })
    const a = await world.run()
    // A second capture whose assessment stopped early.
    world.deps.assessBatch = limitAfter(1, 'capture B')
    const b = await world.run()
    expect(b.status).toBe('partial')
    expect(b.unassessedCategories).toEqual(['g1__Reporting', 'g1__Safety'])
    const calls: string[][] = []
    world.deps.assessBatch = async (input) => {
      calls.push(input.items.map((i) => i.id))
      throw new GroqLimitError(7200)
    }

    const c = await world.run({ scope: 'unfinished', capturedInRunId: a.id })

    // B's list of unfinished categories is not A's, so every category is a candidate.
    expect(calls).toHaveLength(1)
    expect(c.categoriesTotal).toBe(3)
    expect(c.unassessedCategories).toEqual(['g1__Privacy', 'g1__Reporting', 'g1__Safety'])
    // And nothing of B's is shown under A's pages.
    expect(await world.suggestions(c.id)).toEqual([])
  })
})

describe('a carried suggestion is the suggestion it was', () => {
  it('keeps its flags', async () => {
    const world = await createWorld({
      items: THREE_CATEGORIES,
      assess: (input) => ({ ...quoteFirstPassage(input), results: quoteFirstPassage(input).results.map((r) => ({ ...r, confidence: 'low' as const })) }),
    })
    const first = await world.run()
    const before = await world.suggestions(first.id)
    expect(before.every((s) => s.flags.some((f) => f.type === 'low_confidence'))).toBe(true)
    world.deps.assessBatch = async () => {
      throw new GroqLimitError(7200)
    }

    const second = await world.run({ scope: 'all', capturedInRunId: first.id })

    const after = await world.suggestions(second.id)
    expect(after.map((s) => s.flags)).toEqual(before.map((s) => s.flags))
  })
})

describe('a carry that fails loses nothing quietly', () => {
  async function partialFirstRun() {
    const repo = createMemoryRepository()
    const world = await createWorld({ repo, items: THREE_CATEGORIES })
    world.deps.assessBatch = limitAfter(1, 'first')
    const first = await world.run()
    expect(first.unassessedCategories).toEqual(['g1__Reporting', 'g1__Safety'])
    world.deps.assessBatch = async (input) => withReason(input, 'second')
    return { repo, world, first }
  }

  it('assesses everything again when the earlier suggestions cannot be read to pick the categories', async () => {
    const { repo, world, first } = await partialFirstRun()
    const list = repo.listSuggestions.bind(repo)
    let failed = false
    repo.listSuggestions = async (runId) => {
      if (runId === first.id && !failed) {
        failed = true
        throw new Error('network')
      }
      return list(runId)
    }

    const second = await world.run({ scope: 'unfinished', capturedInRunId: first.id })

    expect(second.status).toBe('completed')
    expect(ids(await world.suggestions(second.id))).toEqual(['i1', 'i2', 'i3', 'i4'])
  })

  it('ends partial and lists the categories when the earlier suggestions cannot be read to carry them', async () => {
    const { repo, world, first } = await partialFirstRun()
    const list = repo.listSuggestions.bind(repo)
    let reads = 0
    repo.listSuggestions = async (runId) => {
      // The first read picks the categories; the second is the carry.
      if (runId === first.id && (reads += 1) === 2) throw new Error('network')
      return list(runId)
    }

    const second = await world.run({ scope: 'unfinished', capturedInRunId: first.id })

    expect(second.status).toBe('partial')
    expect(second.unassessedCategories).toContain('g1__Privacy')
    expect(second.error).not.toBeNull()
    expect(ids(await world.suggestions(second.id))).toEqual(['i3', 'i4'])

    // The next unfinished run picks Privacy up.
    const third = await world.run({ scope: 'unfinished', capturedInRunId: first.id })
    expect(third.categoriesTotal).toBeGreaterThan(0)
    expect(third.status).toBe('completed')
    expect(ids(await world.suggestions(third.id))).toEqual(['i1', 'i2', 'i3', 'i4'])
  })

  it('ends partial for the category of a row that cannot be copied, without failing the run', async () => {
    const { repo, world, first } = await partialFirstRun()
    const add = repo.addSuggestion.bind(repo)
    let failed = false
    repo.addSuggestion = async (input) => {
      if (input.itemId === 'i1' && input.reason === 'first' && !failed) {
        failed = true
        throw new Error('write failed')
      }
      return add(input)
    }

    const second = await world.run({ scope: 'unfinished', capturedInRunId: first.id })

    expect(second.status).toBe('partial')
    expect(second.unassessedCategories).toEqual(['g1__Privacy'])
    expect(ids(await world.suggestions(second.id))).toEqual(['i2', 'i3', 'i4'])
    expect(second.error).toMatch(/Privacy|1 category/)
  })
})

describe('unfinished picks up every category that has no suggestion', () => {
  it('assesses a category that was switched off during the last re-assess once it is back', async () => {
    const world = await createWorld({ items: THREE_CATEGORIES })
    const one = await world.run()
    const all = world.audit.items
    world.audit.items = all.filter((i) => i.category !== 'Safety')
    const two = await world.run({ scope: 'all', capturedInRunId: one.id })
    expect(two.status).toBe('completed')
    expect(two.unassessedCategories).toEqual([])
    world.audit.items = all
    const before = world.calls.assess.length

    const three = await world.run({ scope: 'unfinished', capturedInRunId: one.id })

    expect(three.status).toBe('completed')
    expect(world.calls.assess.slice(before).flatMap((c) => c.items.map((i) => i.id))).toEqual(['i4'])
    expect(ids(await world.suggestions(three.id))).toEqual(['i1', 'i2', 'i3', 'i4'])
  })

  it('assesses a category that gained an item since the last run', async () => {
    const world = await createWorld({ items: THREE_CATEGORIES })
    const one = await world.run()
    world.audit.items = [...world.audit.items, item('i5', 'Reporting', 'Can users report abuse from messages?')]
    const before = world.calls.assess.length

    const two = await world.run({ scope: 'unfinished', capturedInRunId: one.id })

    expect(two.categoriesTotal).toBe(1)
    expect(world.calls.assess.slice(before).flatMap((c) => c.items.map((i) => i.id)).sort()).toEqual(['i3', 'i5'])
    expect(ids(await world.suggestions(two.id))).toEqual(['i1', 'i2', 'i3', 'i4', 'i5'])
  })
})

describe('auto-match', () => {
  const four = [
    item('i1', 'Privacy', 'Are teen accounts private by default?'),
    item('i2', 'Privacy', 'Is the default for teen accounts private?'),
    item('i3', 'Reporting', 'Can users report abuse from posts?'),
    item('i4', 'Reporting', 'Can users report abuse quickly?'),
  ]
  const results = { i1: 'yes', i2: 'no', i3: 'partially', i4: 'not_applicable' } as const

  it('records the answer status that matches each of the four results', async () => {
    const world = await createWorld({
      items: four,
      answers: [answer('i1', 'compliant'), answer('i2', 'non_compliant'), answer('i3', 'partially'), answer('i4', 'not_applicable')],
      assess: (input) => {
        const out = quoteFirstPassage(input)
        return { ...out, results: out.results.map((r) => ({ ...r, suggestedResult: results[r.itemId as keyof typeof results] })) }
      },
    })

    await world.run()

    const decisions = await world.repo.listDecisions(PROJECT)
    expect(Object.fromEntries(decisions.map((d) => [d.itemId, d.finalResult]))).toEqual({
      i1: 'compliant',
      i2: 'non_compliant',
      i3: 'partially',
      i4: 'not_applicable',
    })
  })

  describe.each([['pending_review'], ['approved']] as const)('when the audit is %s', (status) => {
    it('records nothing, because decisions on a locked audit are refused', async () => {
      const world = await createWorld({ answers: [answer('i1', 'compliant')] })
      world.audit.getSubmissionStatus = async () => status

      const run = await world.run()

      expect(run.status).toBe('completed')
      expect(await world.repo.listDecisions(PROJECT)).toEqual([])
    })
  })

  it.each([['not_submitted'], ['rejected']] as const)('still records when the audit is %s', async (status) => {
    const world = await createWorld({ answers: [answer('i1', 'compliant')] })
    world.audit.getSubmissionStatus = async () => status

    await world.run()

    expect(await world.repo.listDecisions(PROJECT)).toHaveLength(1)
  })

  it('records nothing, and logs, when the submission status cannot be read', async () => {
    const world = await createWorld({ answers: [answer('i1', 'compliant')] })
    world.audit.getSubmissionStatus = async () => {
      throw new Error('database unreachable')
    }

    const run = await world.run()

    expect(run.status).toBe('completed')
    expect(await world.repo.listDecisions(PROJECT)).toEqual([])
    expect(logged.join('\n')).toMatch(/submission/i)
  })

  it('records nothing when the project has no submission status', async () => {
    const world = await createWorld({ answers: [answer('i1', 'compliant')] })
    world.audit.getSubmissionStatus = async () => null

    await world.run()

    expect(await world.repo.listDecisions(PROJECT)).toEqual([])
  })
})

describe('highlights across pages', () => {
  const SAME = 'Teen accounts are private by default.'
  const twoPages = () => [
    okPage({ url: 'https://p.test/a', finalUrl: 'https://p.test/a', text: `${SAME} Alpha page only.` }),
    okPage({ url: 'https://p.test/b', finalUrl: 'https://p.test/b', text: `${SAME} Bravo page only.` }),
  ]

  async function worldWithUploads(extra: Parameters<typeof createWorld>[0]): Promise<{ world: World; uploads: Map<string, string> }> {
    const repo = createMemoryRepository()
    const uploads = new Map<string, string>()
    const upload = repo.upload.bind(repo)
    repo.upload = async (path, jpeg) => {
      uploads.set(path, jpeg.toString())
      return upload(path, jpeg)
    }
    return { world: await createWorld({ repo, ...extra }), uploads }
  }

  it('keeps each page its own picture when the same quote is on both', async () => {
    const { world, uploads } = await worldWithUploads({
      items: [item('i1', 'Privacy', 'Are teen accounts private by default?'), item('i2', 'Privacy', 'Is the default for teen accounts private?')],
      pages: twoPages(),
      assess: (input) => {
        const byPage = new Map<string, string>()
        for (const p of input.passages) byPage.set(p.pageId, p.id)
        const [pageA, pageB] = [...byPage.keys()]
        return {
          results: input.items.map((it, i) => ({
            itemId: it.id,
            suggestedResult: 'yes' as const,
            reason: 'r',
            quotes: [{ passageId: byPage.get(i === 0 ? pageA : pageB) as string, text: SAME }],
            evidenceSufficient: true,
            conflicting: false,
            webAssessable: true,
            confidence: 'high' as const,
          })),
          missingItemIds: [],
          tokensUsed: 1,
        }
      },
      highlights: async (opts) => new Map(opts.quotes.map((q) => [q, Buffer.from(`img of ${opts.pageUrl}`)])),
    })

    const run = await world.run()
    const found = await world.suggestions(run.id)
    const [first, second] = [found.find((s) => s.itemId === 'i1'), found.find((s) => s.itemId === 'i2')]

    expect(world.calls.highlights).toHaveLength(2)
    const path1 = first?.quotes[0].highlightScreenshotPath as string
    const path2 = second?.quotes[0].highlightScreenshotPath as string
    expect(path1).not.toBe(path2)
    const pageOf = async (s: Suggestion | undefined) => (await world.repo.getPage(s?.quotes[0].pageId as string))?.url
    expect(uploads.get(path1)).toBe(`img of ${await pageOf(first)}`)
    expect(uploads.get(path2)).toBe(`img of ${await pageOf(second)}`)
  })

  it('goes on with the next page when one page cannot be highlighted', async () => {
    const { world } = await worldWithUploads({
      items: [item('i1', 'Privacy', 'Are teen accounts private by default?')],
      pages: [
        okPage({ url: 'https://p.test/a', finalUrl: 'https://p.test/a', text: 'Alpha page says teen accounts are private by default.' }),
        okPage({ url: 'https://p.test/b', finalUrl: 'https://p.test/b', text: 'Bravo page says teen accounts are private by default.' }),
      ],
      assess: (input) => ({
        results: [
          {
            itemId: 'i1',
            suggestedResult: 'yes' as const,
            reason: 'r',
            quotes: input.passages.map((p) => ({ passageId: p.id, text: p.text })),
            evidenceSufficient: true,
            conflicting: false,
            webAssessable: true,
            confidence: 'high' as const,
          },
        ],
        missingItemIds: [],
        tokensUsed: 1,
      }),
      highlights: async (opts) => {
        if (opts.pageUrl.endsWith('/a')) throw new Error('browser hiccup')
        return new Map(opts.quotes.map((q) => [q, Buffer.from('img')]))
      },
    })

    const run = await world.run()
    const [s] = await world.suggestions(run.id)

    expect(run.status).toBe('completed')
    expect(s.quotes).toHaveLength(2)
    expect(s.quotes.filter((q) => q.highlightScreenshotPath !== null)).toHaveLength(1)
  })
})
