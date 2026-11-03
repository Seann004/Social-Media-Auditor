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
})
