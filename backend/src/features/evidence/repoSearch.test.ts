import { describe, it, expect } from 'vitest'
import { findPieces, pieceKey, isCommentLine, isDocsOrTestPath } from './repoSearch.js'
import { MAX_CHARS_PER_PASSAGE } from './config.js'
import type { RepoFile, SearchTerms } from './repoTypes.js'

const terms = (t: Partial<SearchTerms>): SearchTerms => ({ words: [], pathHints: [], paths: [], ...t })
const file = (path: string, lines: string[]): RepoFile => ({ path, lines })
const filler = (n: number, text = 'x'): string[] => Array.from({ length: n }, () => text)
const withAt = (n: number, at: Record<number, string>): string[] =>
  filler(n).map((l, i) => at[i + 1] ?? l)

describe('findPieces', () => {
  it('ranks a file matching 3 words above one matching 1 word 10 times', () => {
    const many = file('a/many.ts', Array.from({ length: 10 }, () => 'alpha'))
    const three = file('b/three.ts', ['alpha', 'beta', 'gamma', 'alpha', 'beta', 'gamma'])
    const out = findPieces([many, three], terms({ words: ['alpha', 'beta', 'gamma'] }), { max: 1 })
    expect(out[0]?.path).toBe('b/three.ts')
  })

  it('lets a path hint lift a weaker file above a stronger one', () => {
    const strong = file('src/a.ts', ['alpha', 'alpha', 'alpha'])
    const weak = file('src/auth/b.ts', ['alpha'])
    expect(findPieces([strong, weak], terms({ words: ['alpha'] }), { max: 1 })[0]?.path).toBe('src/a.ts')
    expect(findPieces([strong, weak], terms({ words: ['alpha'], pathHints: ['auth'] }), { max: 1 })[0]?.path).toBe('src/auth/b.ts')
  })

  it('matches case-insensitively', () => {
    const out = findPieces([file('a.ts', ['Hello WORLD'])], terms({ words: ['world'] }))
    expect(out).toHaveLength(1)
  })

  it('merges two matches 30 lines apart into one 1-based inclusive window', () => {
    const f = file('a.ts', withAt(200, { 100: 'needle', 130: 'needle' }))
    const out = findPieces([f], terms({ words: ['needle'] }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ path: 'a.ts', startLine: 80, endLine: 150 })
    expect(out[0]?.code.split('\n')).toHaveLength(71)
  })

  it('clamps windows to the file', () => {
    const out = findPieces([file('a.ts', withAt(10, { 2: 'needle' }))], terms({ words: ['needle'] }))
    expect(out[0]).toMatchObject({ startLine: 1, endLine: 10 })
  })

  it('ranks windows by distinct words, then total matches, then start line', () => {
    const f = file('a.ts', withAt(300, { 10: 'one', 150: 'one two', 290: 'one' }))
    const out = findPieces([f], terms({ words: ['one', 'two'] }), { max: 3 })
    expect(out.map((p) => p.startLine)).toEqual([130, 1, 270])
  })

  it('takes the best window of each file, then the second-best, in a fixed order', () => {
    const mk = (p: string) => file(p, withAt(300, { 10: 'k', 200: 'k', 201: 'k' }))
    const out = findPieces([mk('c.ts'), mk('a.ts'), mk('b.ts')], terms({ words: ['k'] }), { max: 6 })
    expect(out.map((p) => `${p.path}:${p.startLine}`)).toEqual([
      'a.ts:180', 'b.ts:180', 'c.ts:180', 'a.ts:1', 'b.ts:1', 'c.ts:1',
    ])
  })

  it('stops at max and defaults to 6', () => {
    const files = Array.from({ length: 9 }, (_, i) => file(`f${i}.ts`, ['k']))
    expect(findPieces(files, terms({ words: ['k'] }))).toHaveLength(6)
    expect(findPieces(files, terms({ words: ['k'] }), { max: 2 })).toHaveLength(2)
  })

  it('skips excluded pieces and fills from the next ones', () => {
    const files = [file('a.ts', ['k']), file('b.ts', ['k'])]
    const first = findPieces(files, terms({ words: ['k'] }), { max: 1 })[0]!
    const out = findPieces(files, terms({ words: ['k'] }), { max: 1, exclude: new Set([pieceKey(first)]) })
    expect(out.map((p) => p.path)).toEqual(['b.ts'])
  })

  it('gives the first 41 lines of a named file with no matching line', () => {
    const f = file('docs/policy.md', filler(100).map((_, i) => `line${i + 1}`))
    const out = findPieces([f], terms({ words: ['zzz'], paths: ['docs/policy.md'] }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ startLine: 1, endLine: 41 })
    expect(out[0]?.code.split('\n')).toHaveLength(41)
  })

  it('uses the whole file when a named file is shorter than 41 lines', () => {
    const out = findPieces([file('s.md', ['a', 'b', 'c'])], terms({ words: ['zzz'], paths: ['s.md'] }))
    expect(out[0]).toMatchObject({ startLine: 1, endLine: 3 })
  })

  it('uses the best window of a named file that has matches', () => {
    const f = file('n.ts', withAt(200, { 100: 'needle' }))
    const out = findPieces([f], terms({ words: ['needle'], paths: ['n.ts'] }))
    expect(out[0]).toMatchObject({ startLine: 80, endLine: 120 })
  })

  it('narrows an over-long piece around its first match', () => {
    const f = file('a.ts', withAt(41, { 10: 'needle' }).map((l) => l.padEnd(200, '.')))
    const p = findPieces([f], terms({ words: ['needle'] }))[0]!
    expect(p.code.length).toBeLessThanOrEqual(MAX_CHARS_PER_PASSAGE - 200)
    expect(p.code.split('\n')).toHaveLength(p.endLine - p.startLine + 1)
    expect(p.startLine).toBeLessThanOrEqual(10)
    expect(p.endLine).toBeGreaterThanOrEqual(10)
    expect(p.code).toContain('needle')
    expect(p.endLine - p.startLine + 1).toBeLessThan(41)
  })

  it('returns [] when no file matches', () => {
    expect(findPieces([file('a.ts', ['hello'])], terms({ words: ['zzz'] }))).toEqual([])
    expect(findPieces([], terms({ words: ['zzz'] }))).toEqual([])
  })

  it('sorts equal scores by path so the order is stable', () => {
    const files = [file('b.ts', ['k']), file('c.ts', ['k']), file('a.ts', ['k'])]
    expect(findPieces(files, terms({ words: ['k'] })).map((p) => p.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })
})

describe('pieceKey', () => {
  it('joins path and range', () => {
    expect(pieceKey({ path: 'a/b.ts', startLine: 3, endLine: 9 })).toBe('a/b.ts:3-9')
  })
})

describe('isCommentLine', () => {
  it.each([
    ['', true], ['   ', true], ['// x', true], ['  # x', true], ['/* x', true], [' * x', true],
    ['*/', true], ['<!-- x', true], ['-- sql', true], ['; ini', true],
    ['const a = 1 // x', false], ['x = 1', false], ['<div>', false],
  ])('%j -> %s', (line, expected) => {
    expect(isCommentLine(line)).toBe(expected)
  })
})

describe('isDocsOrTestPath', () => {
  it.each([
    ['README.md', true], ['a/b.mdx', true], ['notes.txt', true], ['x.rst', true],
    ['docs/a.ts', true], ['src/doc/a.ts', true], ['test/a.ts', true], ['src/tests/a.ts', true],
    ['src/__tests__/a.ts', true], ['spec/a.rb', true], ['src/a.test.ts', true], ['src/a.spec.js', true],
    ['src/a.ts', false], ['src/testing/a.ts', false], ['src/latest.ts', false], ['src/docsify.ts', false],
  ])('%s -> %s', (path, expected) => {
    expect(isDocsOrTestPath(path)).toBe(expected)
  })
})
