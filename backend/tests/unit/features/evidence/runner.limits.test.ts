import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWorld,
  okPage,
  PROJECT,
  quoteFirstPassage,
  THREE_CATEGORIES,
} from '../../../fixtures/runnerWorld.js'
import { GroqLimitError } from '../../../../src/lib/groq.js'
import { MAX_TOKENS_PER_RUN } from '../../../../src/features/evidence/config.js'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

const KEYS = ['g1__Privacy', 'g1__Reporting', 'g1__Safety']

describe('Groq limits', () => {
  it('on GroqLimitError ends partial, keeps done categories, lists the rest', async () => {
    const world = await createWorld({
      items: THREE_CATEGORIES,
      assess: (input, call) => {
        if (call === 2) throw new GroqLimitError(7200)
        return quoteFirstPassage(input)
      },
    })

    const run = await world.run()
    const suggestions = await world.suggestions(run.id)

    expect(run.status).toBe('partial')
    expect(run.categoriesDone).toBe(1)
    expect(run.categoriesTotal).toBe(3)
    expect(run.unassessedCategories).toEqual(KEYS.slice(1))
    expect(run.error).toMatch(/daily limit/i)
    expect(run.error).toMatch(/2 categories/)
    // The third category is not tried once the limit is hit.
    expect(world.calls.assess).toHaveLength(2)
    expect(suggestions.map((s) => s.itemId).sort()).toEqual(['i1', 'i2'])
  })

  it('treats a final 429 that surfaced as a plain error as the same limit', async () => {
    const world = await createWorld({
      items: THREE_CATEGORIES,
      assess: (input, call) => {
        if (call === 1) throw new Error('Groq request failed with status 429')
        return quoteFirstPassage(input)
      },
    })

    const run = await world.run()

    expect(run.status).toBe('partial')
    expect(run.unassessedCategories).toEqual(KEYS)
    expect(world.calls.assess).toHaveLength(1)
  })

  it('does not take any other failed request for a limit', async () => {
    const world = await createWorld({
      items: THREE_CATEGORIES,
      assess: (input, call) => {
        if (call === 1) throw new Error('Groq request failed with status 500')
        return quoteFirstPassage(input)
      },
    })

    const run = await world.run()

    expect(run.status).toBe('partial')
    expect(run.unassessedCategories).toEqual([KEYS[0]])
    expect(world.calls.assess).toHaveLength(3)
  })

  it('stops assessing at MAX_TOKENS_PER_RUN and ends partial', async () => {
    const world = await createWorld({
      items: THREE_CATEGORIES,
      assess: (input) => quoteFirstPassage(input, MAX_TOKENS_PER_RUN),
    })

    const run = await world.run()

    expect(run.status).toBe('partial')
    expect(run.tokensUsed).toBe(MAX_TOKENS_PER_RUN)
    expect(run.categoriesDone).toBe(1)
    expect(run.unassessedCategories).toEqual(KEYS.slice(1))
    expect(run.error).toMatch(/token|budget/i)
    expect(world.calls.assess).toHaveLength(1)
  })
})

describe('whole-run timeout', () => {
  it('aborts capture and ends failed when no page was read in time', async () => {
    const world = await createWorld({
      runTimeoutMs: 40,
      capture: (opts) => new Promise<void>((resolve) => opts.signal.addEventListener('abort', () => resolve())),
    })

    const run = await world.run()

    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/time/i)
    expect(world.calls.capture[0].signal.aborted).toBe(true)
    expect(world.calls.assess).toHaveLength(0)
  })

  it('ends partial, keeping the pages, when the time ran out after some were read', async () => {
    const world = await createWorld({
      runTimeoutMs: 40,
      capture: async (opts) => {
        await opts.onPage(okPage())
        await new Promise<void>((resolve) => opts.signal.addEventListener('abort', () => resolve()))
      },
    })

    const run = await world.run()

    expect(run.status).toBe('partial')
    expect(run.unassessedCategories).toEqual(['g1__Privacy', 'g1__Reporting'])
    expect(run.error).toMatch(/time/i)
    expect(await world.repo.listPages(run.id)).toHaveLength(1)
    expect(world.calls.assess).toHaveLength(0)
  })

  it('settles even when the AI call never answers', async () => {
    const world = await createWorld({ runTimeoutMs: 60, assess: () => new Promise(() => undefined) })

    const run = await world.run()

    expect(run.status).toBe('partial')
    expect(run.categoriesDone).toBe(0)
    expect(run.error).toMatch(/time/i)
  })

  it('clears its timer when the run ends', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const world = await createWorld()

    await world.run()

    expect(clear).toHaveBeenCalled()
    expect(world.calls.capture[0].signal.aborted).toBe(false)
  })
})

describe('project of the run', () => {
  it('reads the checklist and platform of the run project', async () => {
    const world = await createWorld()
    const seen: string[] = []
    const items = world.audit.listChecklistItems
    world.audit.listChecklistItems = async (id) => {
      seen.push(id)
      return items(id)
    }

    await world.run()

    expect(seen).toContain(PROJECT)
    expect(world.calls.assess[0]).toMatchObject({ platform: 'TikTok', apiKey: 'gsk_test_secret_key', model: 'test-model' })
  })
})
