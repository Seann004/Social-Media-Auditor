import { describe, it, expect, vi, afterEach } from 'vitest'
import { gzipSync, gunzipSync } from 'node:zlib'
import * as fs from 'node:fs'
import { readArchive } from './repoArchive.js'
import { RepoFetchError } from './repoFetch.js'
import { buildTarGz, paxRecord, tarHeader, tarPadded } from './__fixtures__/fakeGithub.js'
import { REPO_LOCK_FILES, REPO_SKIP_DIRS } from './config.js'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  const names = [
    'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream',
    'mkdir', 'mkdirSync', 'symlink', 'symlinkSync', 'link', 'linkSync', 'copyFile', 'copyFileSync',
  ] as const
  const wrapped: Record<string, unknown> = {}
  for (const n of names) wrapped[n] = vi.fn((real as unknown as Record<string, (...a: unknown[]) => unknown>)[n])
  return { ...real, ...wrapped, default: { ...real, ...wrapped } }
})

const TOO_LARGE = "The repository is larger than 200 MB once unpacked, so it can't be read."
const UNREADABLE = "The repository's download could not be read."

const paths = (gz: Buffer, limits = {}) => readArchive(gz, limits).files.map((f) => f.path)

function fails(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(RepoFetchError)
    return (err as Error).message
  }
  throw new Error('expected a RepoFetchError')
}

afterEach(() => vi.restoreAllMocks())

/** Rewrites the magic bytes of a header block and fixes its checksum. */
function withMagic(header: Buffer, magic: Buffer, prefix: string): Buffer {
  const h = Buffer.from(header)
  magic.copy(h, 257)
  h.write(prefix, 345, 155)
  h.fill(0x20, 148, 156)
  const sum = h.reduce((total, byte) => total + byte, 0)
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return h
}

describe('readArchive', () => {
  it('keeps plain files with the top folder stripped and splits lines on LF and CRLF', () => {
    const result = readArchive(buildTarGz({ 'src/a.ts': 'one\r\ntwo\nthree', 'README.md': 'hi' }))
    expect(result.files).toEqual([
      { path: 'src/a.ts', lines: ['one', 'two', 'three'] },
      { path: 'README.md', lines: ['hi'] },
    ])
    expect(result.skipped).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('keeps a pax long path (over 100 chars) under its full path', () => {
    const long = `${'deep/'.repeat(30)}file.ts`
    expect(long.length).toBeGreaterThan(100)
    const result = readArchive(buildTarGz({ [long]: 'x' }))
    expect(result.files.map((f) => f.path)).toEqual([long])
  })

  it('keeps a GNU long name (L header)', () => {
    const long = `repo-main/${'deep/'.repeat(30)}gnu.ts`
    const body = Buffer.from('gnu')
    const name = Buffer.from(`${long}\0`)
    const gz = buildTarGz({}, {
      rawParts: [
        tarHeader('././@LongLink', 'L', name.length), tarPadded(name),
        tarHeader('short', '0', body.length), tarPadded(body),
      ],
    })
    expect(paths(gz)).toEqual([long.slice('repo-main/'.length)])
  })

  it('ignores a global pax (g) header', () => {
    const record = paxRecord('path', '/evil/global/path')
    const gz = buildTarGz({ 'a.ts': 'x' }, { rawParts: [tarHeader('g', 'g', record.length), tarPadded(record)] })
    expect(paths(gz)).toEqual(['a.ts'])
  })

  it.each(REPO_SKIP_DIRS.map((d) => [d]))('skips the folder %s at the top and nested', (dir) => {
    const gz = buildTarGz({ [`${dir}/a.ts`]: 'x', [`pkg/${dir}/b.ts`]: 'x', [`pkg/${dir}x/c.ts`]: 'x', 'keep.ts': 'x' })
    const result = readArchive(gz)
    expect(result.files.map((f) => f.path)).toEqual([`pkg/${dir}x/c.ts`, 'keep.ts'])
    expect(result.skipped).toBe(2)
  })

  it.each(REPO_LOCK_FILES.map((f) => [f]))('skips the lock file %s', (name) => {
    const result = readArchive(buildTarGz({ [name]: 'x', [`sub/${name}`]: 'x', 'keep.ts': 'x' }))
    expect(result.files.map((f) => f.path)).toEqual(['keep.ts'])
    expect(result.skipped).toBe(2)
  })

  it('skips .min.js and .min.css files', () => {
    const result = readArchive(buildTarGz({ 'a.min.js': 'x', 'b.min.css': 'x', 'c.js': 'x', 'min.js': 'x' }))
    expect(result.files.map((f) => f.path)).toEqual(['c.js', 'min.js'])
    expect(result.skipped).toBe(2)
  })

  it('skips a PNG with a NUL byte and text that is not UTF-8', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), Buffer.from('IHDR')])
    const badUtf8 = Buffer.from([0x61, 0xff, 0xfe, 0x62])
    const result = readArchive(buildTarGz({ 'logo.png': png, 'bad.txt': badUtf8, 'ok.txt': 'fine' }))
    expect(result.files.map((f) => f.path)).toEqual(['ok.txt'])
    expect(result.skipped).toBe(2)
  })

  it('skips a file over maxFileBytes and keeps one exactly at the limit', () => {
    const result = readArchive(buildTarGz({ 'big.ts': 'x'.repeat(11), 'edge.ts': 'x'.repeat(10) }), { maxFileBytes: 10 })
    expect(result.files.map((f) => f.path)).toEqual(['edge.ts'])
    expect(result.skipped).toBe(1)
  })

  it('skips and counts bad paths and entries outside the top folder', () => {
    const file = (name: string) => ({ name, type: '0', body: Buffer.from('x') })
    const gz = buildTarGz({ 'good.ts': 'x' }, {
      extraEntries: [
        file('repo-main/../escape.ts'),
        file('../escape.ts'),
        file('/abs.ts'),
        file('repo-main/a\\b.ts'),
        file('other-folder/x.ts'),
        file('loose.ts'),
        file('repo-main/a/./b.ts'),
      ],
    })
    const result = readArchive(gz)
    expect(result.files.map((f) => f.path)).toEqual(['good.ts'])
    expect(result.skipped).toBe(7)
  })

  it('skips symlinks, hardlinks and folders and never follows a link', () => {
    const gz = buildTarGz({ 'real.ts': 'real' }, {
      extraEntries: [
        { name: 'repo-main/link.ts', type: '2' },
        { name: 'repo-main/hard.ts', type: '1' },
        { name: 'repo-main/src/', type: '5' },
        { name: 'repo-main/dev', type: '3' },
      ],
    })
    const result = readArchive(gz)
    expect(result.files).toEqual([{ path: 'real.ts', lines: ['real'] }])
    expect(result.skipped).toBe(3)
  })

  it('stops after maxFiles kept files and says so', () => {
    const files = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`f${n}.ts`, `n${n}`]))
    const result = readArchive(buildTarGz(files), { maxFiles: 3 })
    expect(result.files.map((f) => f.path)).toEqual(['f1.ts', 'f2.ts', 'f3.ts'])
    expect(result.truncated).toBe(true)
  })

  it('is not truncated when the files exactly fill maxFiles', () => {
    const result = readArchive(buildTarGz({ 'a.ts': '1', 'b.ts': '2' }), { maxFiles: 2 })
    expect(result.files).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })

  it('stops once the kept lines would pass maxTotalLines and says so', () => {
    const gz = buildTarGz({ 'a.ts': '1\n2\n3', 'b.ts': '4\n5', 'c.ts': '6\n7', 'd.ts': '8' })
    const result = readArchive(gz, { maxTotalLines: 5 })
    expect(result.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts'])
    expect(result.truncated).toBe(true)
  })

  it('is not truncated when the lines exactly fill maxTotalLines', () => {
    const result = readArchive(buildTarGz({ 'a.ts': '1\n2\n3', 'b.ts': '4\n5' }), { maxTotalLines: 5 })
    expect(result.files).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })

  it('skips and counts a ustar name holding a newline', () => {
    const body = Buffer.from('x')
    const gz = buildTarGz({ 'good.ts': 'g' }, {
      rawParts: [tarHeader('repo-main/src/x\nconst isPrivate = age < 18; .ts', '0', body.length), tarPadded(body)],
    })
    const result = readArchive(gz)
    expect(result.files.map((f) => f.path)).toEqual(['good.ts'])
    expect(result.skipped).toBe(1)
  })

  it('skips and counts a pax path holding a newline', () => {
    const rec = paxRecord('path', 'repo-main/src/x\nconst isPrivate = age < 18; .ts')
    const body = Buffer.from('x')
    const gz = buildTarGz({ 'good.ts': 'g' }, {
      rawParts: [
        tarHeader('PaxHeader', 'x', rec.length), tarPadded(rec),
        tarHeader('repo-main/ok.ts', '0', body.length), tarPadded(body),
      ],
    })
    const result = readArchive(gz)
    expect(result.files.map((f) => f.path)).toEqual(['good.ts'])
    expect(result.skipped).toBe(1)
  })

  it('skips and counts names holding a tab or another control character', () => {
    const file = (name: string) => ({ name, type: '0', body: Buffer.from('x') })
    const gz = buildTarGz({ 'good.ts': 'x' }, {
      extraEntries: [file('repo-main/a\tb.ts'), file('repo-main/c\rd.ts'), file('repo-main/e\x7ff.ts'), file('repo-main/g\x1bh.ts')],
    })
    const result = readArchive(gz)
    expect(result.files.map((f) => f.path)).toEqual(['good.ts'])
    expect(result.skipped).toBe(4)
  })

  it('throws the size sentence when the unpacked archive passes the limit', () => {
    const gz = buildTarGz({ 'big.txt': 'a'.repeat(200_000) })
    expect(gz.length).toBeLessThan(5_000)
    expect(fails(() => readArchive(gz, { maxUnpackedBytes: 50_000 }))).toBe(TOO_LARGE)
  })

  it('throws the unreadable sentence for corrupt bytes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(fails(() => readArchive(Buffer.from('definitely not gzip')))).toBe(UNREADABLE)
    expect(console.error).toHaveBeenCalled()
  })

  it('throws the unreadable sentence for gzip that holds a broken tar', () => {
    expect(fails(() => readArchive(gzipSync(Buffer.alloc(512, 0x41))))).toBe(UNREADABLE)
    expect(readArchive(gzipSync(Buffer.alloc(0))).files).toEqual([])
  })

  it('throws the unreadable sentence when the tar is cut inside a header', () => {
    const tar = gunzipSync(buildTarGz({ 'a.ts': 'x'.repeat(2000) }))
    expect(fails(() => readArchive(gzipSync(tar.subarray(0, 700))))).toBe(UNREADABLE)
  })

  it('throws the unreadable sentence when the tar is cut inside a body', () => {
    const tar = gunzipSync(buildTarGz({ 'a.ts': 'x'.repeat(2000) }))
    // Block 0 is the top folder, block 1 is a.ts's header, its body starts at 1024.
    expect(fails(() => readArchive(gzipSync(tar.subarray(0, 1024 + 300))))).toBe(UNREADABLE)
  })

  it('skips and counts a bad path that arrives in a pax path header', () => {
    const rec = paxRecord('path', 'repo-main/../../out.ts')
    const body = Buffer.from('x')
    const gz = buildTarGz({ 'good.ts': 'g' }, {
      rawParts: [
        tarHeader('PaxHeader', 'x', rec.length), tarPadded(rec),
        tarHeader('repo-main/ok.ts', '0', body.length), tarPadded(body),
      ],
    })
    const result = readArchive(gz)
    expect(result.files.map((f) => f.path)).toEqual(['good.ts'])
    expect(result.skipped).toBe(1)
  })

  it('skips and counts a bad path that arrives in a GNU long name', () => {
    const name = Buffer.from('repo-main/../../out.ts\0')
    const body = Buffer.from('x')
    const gz = buildTarGz({ 'good.ts': 'g' }, {
      rawParts: [
        tarHeader('././@LongLink', 'L', name.length), tarPadded(name),
        tarHeader('repo-main/ok.ts', '0', body.length), tarPadded(body),
      ],
    })
    const result = readArchive(gz)
    expect(result.files.map((f) => f.path)).toEqual(['good.ts'])
    expect(result.skipped).toBe(1)
  })

  it('uses a pax size override for the next entry body', () => {
    const rec = paxRecord('size', '3')
    const body = Buffer.from('abcdefghij')
    const gz = buildTarGz({}, {
      rawParts: [
        tarHeader('PaxHeader', 'x', rec.length), tarPadded(rec),
        tarHeader('repo-main/s.ts', '0', body.length), tarPadded(body),
      ],
    })
    expect(readArchive(gz).files).toEqual([{ path: 's.ts', lines: ['abc'] }])
  })

  it('ignores the prefix field unless the magic is "ustar\0"', () => {
    const body = Buffer.from('old')
    const old = withMagic(tarHeader('repo-main/old.ts', '0', body.length), Buffer.from('ustar  \0'), 'junk')
    const gz = buildTarGz({}, { rawParts: [old, tarPadded(body)] })
    expect(paths(gz)).toEqual(['old.ts'])
    const modern = withMagic(tarHeader('old.ts', '0', body.length), Buffer.from('ustar\0' + '00'), 'repo-main')
    expect(paths(buildTarGz({}, { rawParts: [modern, tarPadded(body)] }))).toEqual(['old.ts'])
  })

  it('requires a plain decimal pax record length', () => {
    const rec = Buffer.from('0x19 path=repo-main/x.ts\n')
    expect(rec.length).toBe(25)
    const body = Buffer.from('x')
    const gz = buildTarGz({}, {
      rawParts: [
        tarHeader('PaxHeader', 'x', rec.length), tarPadded(rec),
        tarHeader('repo-main/ok.ts', '0', body.length), tarPadded(body),
      ],
    })
    expect(paths(gz)).toEqual(['ok.ts'])
  })

  it('never writes to disk', () => {
    readArchive(buildTarGz({ 'a.ts': 'x' }, { extraEntries: [{ name: 'repo-main/l', type: '2' }, { name: '../x', type: '0' }] }))
    for (const name of [
      'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream',
      'mkdir', 'mkdirSync', 'symlink', 'symlinkSync', 'link', 'linkSync', 'copyFile', 'copyFileSync',
    ] as const) {
      expect(vi.isMockFunction(fs[name])).toBe(true)
      expect(vi.mocked(fs[name] as (...a: unknown[]) => unknown)).not.toHaveBeenCalled()
    }
  })
})
