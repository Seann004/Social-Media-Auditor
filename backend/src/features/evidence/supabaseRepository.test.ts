import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseRepository, createSupabaseScreenshotStore } from './supabaseRepository.js'

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

  it('getSuggestedResults is one read of id and suggestedResult only', async () => {
    const selected: string[] = []
    let reads = 0
    const admin = {
      from: () => ({
        select: (columns: string) => {
          selected.push(columns)
          reads += 1
          return builder({ data: [{ id: 'a', suggestedResult: 'yes' }, { id: 'b', suggestedResult: null }], error: null }, [], 'x')
        },
      }),
    } as unknown as SupabaseClient
    expect(await createSupabaseRepository(admin).getSuggestedResults(['a', 'b'])).toEqual({ a: 'yes', b: null })
    expect(reads).toBe(1)
    expect(selected[0].replace(/\s/g, '')).toBe('id,suggestedResult')
  })
})
