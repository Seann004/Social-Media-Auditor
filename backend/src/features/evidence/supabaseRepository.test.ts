import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_READ_PAGE_SIZE } from './config.js'
import { createSupabaseRepository, createSupabaseScreenshotStore } from './supabaseRepository.js'

type Row = Record<string, unknown>
/** PostgREST's default db-max-rows. */
const POSTGREST_CAP = 1_000

/** Chainable stand-in for a query builder that resolves to a fixed result. */
function builder(result: unknown, log: string[], name: string): any {
  const proxy: any = new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
      return (...args: unknown[]) => {
        log.push(`${name}.${String(prop)}(${args.map((a) => (typeof a === 'string' ? a : '')).join(',')})`)
        return proxy
      }
    },
  })
  return proxy
}

describe('supabase repository without a database', () => {
  it('deletes the suggestion and rethrows when the quote insert fails', async () => {
    const log: string[] = []
    const admin = {
      from(table: string) {
        if (table === 'AI_Suggestion') {
          return {
            insert: () => builder({ data: { id: 's1', runId: 'r', projectId: 'p', itemId: 'i', reason: '', confidence: 'low', flags: [] }, error: null }, log, 'insert'),
            delete: () => builder({ error: null }, log, 'delete'),
          }
        }
        return { insert: () => builder({ data: null, error: { message: 'boom' } }, log, 'quoteInsert') }
      },
    } as unknown as SupabaseClient
    const repo = createSupabaseRepository(admin)

    await expect(
      repo.addSuggestion({
        runId: 'r',
        projectId: 'p',
        itemId: 'i',
        suggestedResult: null,
        reason: '',
        confidence: 'low',
        flags: [],
        passageIdsSent: [],
        quotes: [{ passageId: null, pageId: null, quoteText: 'q', verified: false, highlightScreenshotPath: null }],
      }),
    ).rejects.toThrow(/addSuggestion quotes: boom/)
    expect(log).toContain('delete.eq(id,s1)')
  })

  it('names the operation in database errors', async () => {
    const admin = {
      from: () => builder({ data: null, error: { message: 'down' } }, [], 'x'),
    } as unknown as SupabaseClient
    await expect(createSupabaseRepository(admin).getRun('r')).rejects.toThrow('getRun: down')
  })

  it('removeProject walks nested folders and removes every file', async () => {
    const tree: Record<string, { name: string; id: string | null }[]> = {
      p1: [{ name: 'run1', id: null }, { name: 'top.jpg', id: 'a' }],
      'p1/run1': [{ name: 'deep', id: null }, { name: 'one.jpg', id: 'b' }],
      'p1/run1/deep': [{ name: 'two.jpg', id: 'c' }],
    }
    const removed: string[] = []
    const admin = {
      storage: {
        from: () => ({
          list: async (prefix: string) => ({ data: tree[prefix] ?? [], error: null }),
          remove: async (paths: string[]) => {
            removed.push(...paths)
            return { error: null }
          },
        }),
      },
    } as unknown as SupabaseClient

    await createSupabaseScreenshotStore(admin).removeProject('p1')
    expect(removed.sort()).toEqual(['p1/run1/deep/two.jpg', 'p1/run1/one.jpg', 'p1/top.jpg'])
  })

  it('stores the passage ids sent with the suggestion, and reads them back', async () => {
    const inserted: Record<string, unknown>[] = []
    const row = { id: 's1', runId: 'r', projectId: 'p', itemId: 'i', reason: '', confidence: 'low', flags: [], passageIdsSent: ['a', 'b'] }
    const admin = {
      from: () => ({
        insert: (value: Record<string, unknown>) => {
          inserted.push(value)
          return builder({ data: row, error: null }, [], 'insert')
        },
      }),
    } as unknown as SupabaseClient

    const saved = await createSupabaseRepository(admin).addSuggestion({
      runId: 'r',
      projectId: 'p',
      itemId: 'i',
      suggestedResult: null,
      reason: '',
      confidence: 'low',
      flags: [],
      passageIdsSent: ['a', 'b'],
      quotes: [],
    })

    expect(inserted[0].passageIdsSent).toEqual(['a', 'b'])
    expect(saved.passageIdsSent).toEqual(['a', 'b'])
  })

  describe('an id that is not a uuid', () => {
    const castError = { message: 'invalid input syntax for type uuid: "abc"', code: '22P02' }
    const downError = { message: 'down', code: '08006' }
    const repoWith = (error: unknown) =>
      createSupabaseRepository({ from: () => builder({ data: null, error }, [], 'x') } as unknown as SupabaseClient)

    it.each(['getRun', 'getPage', 'getSuggestion', 'getQuote'] as const)('%s treats a cast error as no row', async (method) => {
      expect(await repoWith(castError)[method]('abc')).toBeNull()
    })

    it.each(['getRun', 'getPage', 'getSuggestion', 'getQuote'] as const)('%s still throws on any other error', async (method) => {
      await expect(repoWith(downError)[method]('abc')).rejects.toThrow(/down/)
    })
  })

  it('listPageSummaries asks for the view columns only', async () => {
    const selected: string[] = []
    const admin = {
      from: () => ({
        select: (columns: string) => {
          selected.push(columns)
          return builder({ data: [], error: null }, [], 'x')
        },
      }),
    } as unknown as SupabaseClient
    await createSupabaseRepository(admin).listPageSummaries('r')
    expect(selected[0]).not.toMatch(/\*|text|accessibilitySnapshot|contentHash/)
    expect(selected[0]).toContain('screenshotPath')
  })

  it('stores where a copy came from, and null for a suggestion with no origin', async () => {
    const inserted: Record<string, unknown>[] = []
    const admin = {
      from: () => ({
        insert: (value: Record<string, unknown>) => {
          inserted.push(value)
          return builder({ data: { id: 's1', runId: 'r', projectId: 'p', itemId: 'i', reason: '', confidence: 'low', ...value }, error: null }, [], 'insert')
        },
      }),
    } as unknown as SupabaseClient
    const repo = createSupabaseRepository(admin)
    const input = { runId: 'r', projectId: 'p', itemId: 'i', suggestedResult: null, reason: '', confidence: 'low' as const, flags: [], passageIdsSent: [], quotes: [] }

    const fresh = await repo.addSuggestion(input)
    const copy = await repo.addSuggestion({ ...input, originSuggestionId: 'first' })

    expect(inserted.map((row) => row.originSuggestionId)).toEqual([null, 'first'])
    expect(fresh.originSuggestionId).toBeNull()
    expect(copy.originSuggestionId).toBe('first')
  })

  it('getSuggestionSummaries is one read of id, suggestedResult and originSuggestionId only', async () => {
    const selected: string[] = []
    let reads = 0
    const admin = {
      from: () => ({
        select: (columns: string) => {
          selected.push(columns)
          reads += 1
          return builder({ data: [{ id: 'a', suggestedResult: 'yes', originSuggestionId: 'o' }, { id: 'b', suggestedResult: null }], error: null }, [], 'x')
        },
      }),
    } as unknown as SupabaseClient
    expect(await createSupabaseRepository(admin).getSuggestionSummaries(['a', 'b'])).toEqual({
      a: { suggestedResult: 'yes', originSuggestionId: 'o' },
      b: { suggestedResult: null, originSuggestionId: null },
    })
    expect(reads).toBe(1)
    expect(selected[0].replace(/\s/g, '')).toBe('id,suggestedResult,originSuggestionId')
  })

  describe('reads past the row cap of PostgREST', () => {
    /** Answers like PostgREST: never more than the cap in one reply, whatever the range asks for. */
    function cappedTable(rows: Row[], reads: { orders: string[]; ranges: [number, number][] }, failOnRead?: number) {
      const query = (window: [number, number]): any => ({
        select: () => query(window),
        eq: () => query(window),
        in: () => query(window),
        order: (column: string) => {
          reads.orders.push(column)
          return query(window)
        },
        range: (from: number, to: number) => {
          reads.ranges.push([from, to])
          return query([from, to])
        },
        then: (done: (v: unknown) => unknown) => {
          const failing = failOnRead !== undefined && reads.ranges.length === failOnRead
          const answer = failing
            ? { data: null, error: { message: 'down' } }
            : { data: rows.slice(window[0], Math.min(window[1] + 1, window[0] + POSTGREST_CAP)), error: null }
          return Promise.resolve(answer).then(done)
        },
      })
      return query([0, Number.MAX_SAFE_INTEGER])
    }
    const newReads = () => ({ orders: [] as string[], ranges: [] as [number, number][] })
    const decisions = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, itemId: `i${i}` }))

    it('listDecisions returns every decision, the newest included, in order', async () => {
      const reads = newReads()
      const rows = decisions(1_203)
      const repo = createSupabaseRepository({ from: () => cappedTable(rows, reads) } as unknown as SupabaseClient)

      const got = await repo.listDecisions('p')

      expect(got.map((d) => d.id)).toEqual(rows.map((r) => r.id))
      expect(reads.ranges[0]).toEqual([0, SUPABASE_READ_PAGE_SIZE - 1])
      expect(reads.orders).toContain('decidedAt')
      expect(reads.orders).toContain('id')
    })

    it('listDecisions stops when a full page turns out to be the last', async () => {
      const reads = newReads()
      const repo = createSupabaseRepository({ from: () => cappedTable(decisions(SUPABASE_READ_PAGE_SIZE), reads) } as unknown as SupabaseClient)
      expect(await repo.listDecisions('p')).toHaveLength(SUPABASE_READ_PAGE_SIZE)
      expect(reads.ranges).toHaveLength(2)
    })

    it('listDecisions names itself when a later page fails, rather than returning part of the list', async () => {
      const reads = newReads()
      const repo = createSupabaseRepository({ from: () => cappedTable(decisions(1_203), reads, 2) } as unknown as SupabaseClient)
      await expect(repo.listDecisions('p')).rejects.toThrow('listDecisions: down')
    })

    const quoteRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `q${String(i).padStart(4, '0')}`, suggestionId: 's1', quoteText: 't', verified: true }))
    const suggestionRow = { id: 's1', runId: 'r', projectId: 'p', itemId: 'i', reason: '', confidence: 'low' }

    it('listSuggestions attaches every quote, ordered by id so the pictures are stable', async () => {
      const reads = newReads()
      const quotes = quoteRows(1_203)
      const repo = createSupabaseRepository({
        from: (table: string) => (table === 'AI_Suggestion' ? builder({ data: [suggestionRow], error: null }, [], 's') : cappedTable(quotes, reads)),
      } as unknown as SupabaseClient)

      const [found] = await repo.listSuggestions('r')

      expect(found.quotes.map((q) => q.id)).toEqual(quotes.map((q) => q.id))
      expect(reads.orders).toEqual(expect.arrayContaining(['id']))
    })

    it('getSuggestion orders its quotes by id as well', async () => {
      const reads = newReads()
      const repo = createSupabaseRepository({
        from: (table: string) => (table === 'AI_Suggestion' ? builder({ data: suggestionRow, error: null }, [], 's') : cappedTable(quoteRows(2), reads)),
      } as unknown as SupabaseClient)

      expect((await repo.getSuggestion('s1'))?.quotes).toHaveLength(2)
      expect(reads.orders).toContain('id')
    })

    it('addSuggestion returns its quotes in the order a read gives them', async () => {
      const inserted = [{ id: 'q2', quoteText: 'b', verified: false }, { id: 'q1', quoteText: 'a', verified: false }]
      const repo = createSupabaseRepository({
        from: (table: string) => ({
          insert: () => builder({ data: table === 'AI_Suggestion' ? suggestionRow : inserted, error: null }, [], 'insert'),
        }),
      } as unknown as SupabaseClient)
      const saved = await repo.addSuggestion({
        runId: 'r', projectId: 'p', itemId: 'i', suggestedResult: null, reason: '', confidence: 'low', flags: [], passageIdsSent: [],
        quotes: [{ passageId: null, pageId: null, quoteText: 'b', verified: false, highlightScreenshotPath: null }, { passageId: null, pageId: null, quoteText: 'a', verified: false, highlightScreenshotPath: null }],
      })
      expect(saved.quotes.map((q) => q.id)).toEqual(['q1', 'q2'])
    })
  })
})
