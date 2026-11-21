import { describe, it, expect } from 'vitest'
import { findPieces, pieceKey, isCommentLine, isDocsOrTestPath, isLocalePath, usableAvoidWords } from '../../../../src/features/evidence/repoSearch.js'
import { MAX_CHARS_PER_PASSAGE } from '../../../../src/features/evidence/config.js'
import type { RepoFile, SearchTerms } from '../../../../src/features/evidence/repoTypes.js'

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
    // The third window is past the folder cap, and is backfilled because nothing else matches.
    const out = findPieces([f], terms({ words: ['one', 'two'] }), { max: 3 })
    expect(out.map((p) => p.startLine)).toEqual([130, 1, 270])
  })

  it('takes the best window of each file, then the second-best, in a fixed order', () => {
    // Each file sits in its own folder, so the 2-per-folder cap does not apply.
    const mk = (p: string) => file(p, withAt(300, { 10: 'k', 200: 'k', 201: 'k' }))
    const out = findPieces([mk('c/x.ts'), mk('a/x.ts'), mk('b/x.ts')], terms({ words: ['k'] }), { max: 6 })
    expect(out.map((p) => `${p.path}:${p.startLine}`)).toEqual([
      'a/x.ts:180', 'b/x.ts:180', 'c/x.ts:180', 'a/x.ts:1', 'b/x.ts:1', 'c/x.ts:1',
    ])
  })

  it('stops at max and defaults to 6', () => {
    // One folder per file, so the 2-per-folder cap does not apply.
    const files = Array.from({ length: 9 }, (_, i) => file(`d${i}/f.ts`, ['k']))
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

  it('gives the same pieces as the dense matcher on a mixed corpus', () => {
    // Expected values were recorded from the earlier one-array-per-line matcher.
    const lines = (n: number, at: Record<number, string>) => Array.from({ length: n }, (_, i) => at[i + 1] ?? `line ${i + 1}`)
    const corpus = [
      file('src/auth/AgeGate.ts', lines(120, { 5: 'const MIN_AGE = 13', 30: 'if (user.Age < MIN_AGE) block()', 31: 'Parental CONSENT required', 90: 'age check again' })),
      file('src/profile/privacy.ts', lines(80, { 10: 'isPrivate = age < 18', 11: 'default PRIVATE for minors', 70: 'ΣΊΣΥΦΟΣ privacy' })),
      file('docs/consent.md', lines(50, { 2: 'Consent policy', 45: 'parental consent age' })),
      file('src/empty.ts', []),
      file('src/named.ts', lines(60, {})),
      file('src/crlf.ts', ['age\r', 'x', 'CONSENT\r']),
    ]
    const range = (p: { path: string; startLine: number; endLine: number }) => `${p.path}:${p.startLine}-${p.endLine}`
    const first = findPieces(corpus, terms({
      words: ['age', 'consent', 'private', 'σίσυφος'], pathHints: ['auth', 'profile'], paths: ['src/named.ts', 'src/empty.ts'],
    }), { max: 10 })
    expect(first.map(range)).toEqual([
      'src/auth/AgeGate.ts:1-51', 'src/profile/privacy.ts:1-31', 'docs/consent.md:25-50', 'src/crlf.ts:1-3',
      'src/named.ts:1-41', 'src/auth/AgeGate.ts:70-110', 'src/profile/privacy.ts:50-80', 'docs/consent.md:1-22',
    ])
    expect(first.map((p) => p.code.length)).toEqual([452, 270, 220, 15, 318, 346, 255, 174])
    for (const p of first) {
      const source = corpus.find((f) => f.path === p.path)!
      expect(p.code).toBe(source.lines.slice(p.startLine - 1, p.endLine).join('\n'))
    }
    const second = findPieces(corpus, terms({ words: ['  AGE ', '', 'block'] }), {
      max: 3, exclude: new Set(['src/auth/AgeGate.ts:10-51']),
    })
    expect(second.map(range)).toEqual(['src/auth/AgeGate.ts:1-50', 'docs/consent.md:25-50', 'src/crlf.ts:1-3'])
  })

  it('never matches a word across two lines', () => {
    expect(findPieces([file('a.ts', ['par', 'ental'])], terms({ words: ['par\nental'] }))).toEqual([])
  })

  it('sorts equal scores by path so the order is stable', () => {
    // One folder per file, so the 2-per-folder cap does not apply.
    const files = [file('b/k.ts', ['k']), file('c/k.ts', ['k']), file('a/k.ts', ['k'])]
    expect(findPieces(files, terms({ words: ['k'] })).map((p) => p.path)).toEqual(['a/k.ts', 'b/k.ts', 'c/k.ts'])
  })
})

describe('findPieces: locale files and the folder cap', () => {
  const locale = (lang: string) => file(`config/locales/simple_form.${lang}.yml`, ['age: Age', 'private: Private account', 'age minimum'])

  it('skips locale files when real code matches, even when they score higher', () => {
    const code = file('app/models/account.rb', ['def default_private?', '  age < 16', 'end'])
    const out = findPieces([locale('ar'), locale('be'), locale('bg'), code], terms({ words: ['age', 'private'] }))
    expect(out.map((p) => p.path)).toEqual(['app/models/account.rb'])
  })

  it('uses locale files when no other file matches, so a translations-only repository gets an answer', () => {
    const out = findPieces([locale('ar'), file('app/x.rb', ['nothing here'])], terms({ words: ['age'] }))
    expect(out.map((p) => p.path)).toEqual(['config/locales/simple_form.ar.yml'])
  })

  it('still gives a locale file named in terms.paths', () => {
    const code = file('app/models/account.rb', ['age'])
    const out = findPieces([locale('ar'), locale('be'), code], terms({ words: ['age'], paths: ['config/locales/simple_form.be.yml'] }))
    expect(out.map((p) => p.path).sort()).toEqual(['app/models/account.rb', 'config/locales/simple_form.be.yml'])
  })

  it('takes 2 pieces per folder first, then backfills the skipped ones in rank order', () => {
    const many = Array.from({ length: 5 }, (_, i) => file(`app/models/m${i}.rb`, withAt(300, { 10: 'age', 200: 'age' })))
    const other = file('app/services/s.rb', ['age'])
    const out = findPieces([...many, other], terms({ words: ['age'] }), { max: 6 })
    expect(out.map((p) => p.path)).toEqual([
      'app/models/m0.rb', 'app/models/m1.rb', 'app/services/s.rb', 'app/models/m2.rb', 'app/models/m3.rb', 'app/models/m4.rb',
    ])
  })

  it('a flat repository with every file in src/ still gets up to 6 pieces, the most varied first', () => {
    const flat = Array.from({ length: 8 }, (_, i) => file(`src/f${i}.ts`, i < 2 ? ['age private consent'] : ['age']))
    const lib = file('lib/l.ts', ['age'])
    const out = findPieces([...flat, lib], terms({ words: ['age', 'private', 'consent'] }))
    expect(out.map((p) => p.path)).toEqual(['src/f0.ts', 'src/f1.ts', 'lib/l.ts', 'src/f2.ts', 'src/f3.ts', 'src/f4.ts'])
    expect(findPieces(flat, terms({ words: ['age'] }))).toHaveLength(6)
  })

  it('a named file in a folder whose 2 slots are taken is still included', () => {
    const many = Array.from({ length: 4 }, (_, i) => file(`app/models/m${i}.rb`, ['age', 'age', 'age']))
    const named = file('app/models/zz_named.rb', ['nothing to see'])
    const out = findPieces([...many, named], terms({ words: ['age'], paths: ['app/models/zz_named.rb'] }), { max: 3 })
    expect(out.map((p) => p.path)).toEqual(['app/models/m0.rb', 'app/models/m1.rb', 'app/models/zz_named.rb'])
  })
})

describe('isLocalePath', () => {
  it.each([
    ['config/locales/en.yml', true], ['src/locale/fr.json', true], ['src/i18n/de.ts', true], ['l10n/x.json', true],
    ['res/lang/en.php', true], ['langs/a.json', true], ['src/translations/es.json', true], ['Config/Locales/en.yml', true],
    ['po/de.po', true], ['messages.pot', true], ['a/b.xliff', true], ['a/b.xlf', true], ['ios/Localizable.strings', true],
    ['app/models/account.rb', false], ['src/localeHelpers.ts', false], ['src/language.ts', false], ['src/i18n.ts', false],
  ])('%s -> %s', (path, expected) => {
    expect(isLocalePath(path)).toBe(expected)
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

describe('findPieces: paths the AI asked to rank lower (avoidPaths)', () => {
  // The live Mastodon case: admin code repeats "report" far more often than the user-facing controller.
  const admin = file('app/controllers/admin/reports_controller.rb', filler(12, 'report report_note'))
  const adminUi = file('app/javascript/notification_admin_report.tsx', filler(8, 'report'))
  const user = file('app/controllers/api/v1/reports_controller.rb', ['def create', '  @report = ReportService.new.call', 'end', 'report_params'])
  const words = ['report']

  it('without avoidPaths, the admin files win on plain matches', () => {
    expect(findPieces([admin, adminUi, user], terms({ words }), { max: 1 })[0]?.path).toBe(admin.path)
  })

  it('ranks admin files below user-facing files with the same words, by folder or by a word of the file name', () => {
    const out = findPieces([admin, adminUi, user], terms({ words, avoidPaths: ['admin'] }), { max: 3 })
    expect(out.map((p) => p.path)).toEqual([user.path, admin.path, adminUi.path])
  })

  it('a word only inside a longer path word is not an avoided segment', () => {
    const administrator = file('app/administrator/reports.rb', filler(12, 'report'))
    expect(findPieces([administrator, user], terms({ words, avoidPaths: ['admin'] }), { max: 1 })[0]?.path).toBe(administrator.path)
  })

  it('still uses an admin file when nothing else matches', () => {
    const out = findPieces([admin, file('app/models/user.rb', ['class User'])], terms({ words, avoidPaths: ['admin', 'moderation'] }))
    expect(out.map((p) => p.path)).toEqual([admin.path])
  })

  it('a file named in terms.paths is exempt from the penalty', () => {
    const out = findPieces([admin, user], terms({ words, avoidPaths: ['admin'], paths: [admin.path] }), { max: 1 })
    expect(out[0]?.path).toBe(admin.path)
  })

  it('the penalty is capped, so a strong admin match still beats a weak user-facing one with no word in its path', () => {
    const weak = file('app/models/account.rb', ['report'])
    const strong = file('app/admin/moderation/staff/reports.rb', filler(12, 'report report_note abuse'))
    const out = findPieces([strong, weak], terms({ words: ['report', 'abuse'], avoidPaths: ['admin', 'moderation', 'staff'] }), { max: 1 })
    expect(out[0]?.path).toBe(strong.path)
  })
})

describe('findPieces: avoid words that would hide what the item needs', () => {
  // Scores before any penalty: admin 3 + 2 (report in its path), user 4 + 2.
  const admin = file('app/controllers/admin/reports_controller.rb', filler(3, 'report'))
  const user = file('app/controllers/api/v1/reports_controller.rb', filler(4, 'report'))
  const first = (t: Partial<SearchTerms>) => findPieces([admin, user], terms({ words: ['report'], ...t }), { max: 1 })[0]?.path

  it('drops an avoid word that is also one of the path hints or search words', () => {
    expect(first({ avoidPaths: ['admin'] })).toBe(user.path)
    expect(first({ avoidPaths: ['admin'], pathHints: ['admin'] })).toBe(admin.path)
    expect(first({ words: ['report', 'Admin'], avoidPaths: ['admin'] })).toBe(admin.path)
  })

  it('drops layer names, which would rank the user-facing code lower too', () => {
    const apiHeavy = file('app/controllers/api/v1/admin_reports.rb', filler(12, 'report'))
    const plain = file('app/models/report.rb', ['report', 'report'])
    for (const layer of ['api', 'controllers', 'models', 'services', 'views', 'app', 'src', 'lib']) {
      expect(findPieces([apiHeavy, plain], terms({ words: ['report'], avoidPaths: [layer] }), { max: 1 })[0]?.path).toBe(apiHeavy.path)
    }
  })
})

describe('usableAvoidWords', () => {
  it('keeps only avoid words that are not layers, hints or search words, lower case and once each', () => {
    expect(usableAvoidWords(terms({ words: ['report'], pathHints: ['settings'], avoidPaths: ['Admin', 'admin', 'api', 'Settings', 'REPORT', 'staff'] }))).toEqual([
      'admin',
      'staff',
    ])
    expect(usableAvoidWords(terms({ words: ['x'] }))).toEqual([])
  })
})
