import { gunzipSync } from 'node:zlib'
import {
  REPO_LOCK_FILES,
  REPO_MAX_FILES,
  REPO_MAX_FILE_BYTES,
  REPO_MAX_UNPACKED_BYTES,
  REPO_SKIP_DIRS,
} from './config.js'
import { RepoFetchError } from './repoFetch.js'
import type { RepoFile } from './repoTypes.js'

export interface ArchiveLimits {
  maxUnpackedBytes: number
  maxFiles: number
  maxFileBytes: number
}

export interface ArchiveResult {
  files: RepoFile[]
  skipped: number
  truncated: boolean
}

const TOO_LARGE = "The repository is larger than 200 MB once unpacked, so it can't be read."
const UNREADABLE = "The repository's download could not be read."

const BLOCK = 512
const BINARY_SCAN_BYTES = 8_000

/** One tar entry after any long-name or pax header has been applied to it. */
interface TarEntry {
  path: string
  type: string
  body: Buffer
}

function cString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length)
  const nul = slice.indexOf(0)
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString('utf8')
}

function parseOctal(buf: Buffer, start: number, length: number): number {
  const text = cString(buf, start, length).trim()
  if (!/^[0-7]+$/.test(text)) throw new RepoFetchError(UNREADABLE)
  return parseInt(text, 8)
}

function checksumOk(header: Buffer): boolean {
  let sum = 0
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0)
  const text = cString(header, 148, 8).trim()
  return /^[0-7]+$/.test(text) && parseInt(text, 8) === sum
}

/** Reads pax records ("<length> <key>=<value>\n"); a malformed record ends the parse. */
function parsePax(body: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  let pos = 0
  while (pos < body.length) {
    const space = body.indexOf(0x20, pos)
    if (space === -1) break
    const length = Number(body.subarray(pos, space).toString('ascii'))
    if (!Number.isInteger(length) || length <= space - pos + 1 || pos + length > body.length) break
    const record = body.subarray(space + 1, pos + length - 1).toString('utf8')
    const eq = record.indexOf('=')
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1))
    pos += length
  }
  return out
}

/** Walks the tar blocks and yields entries with GNU long names and pax paths applied. */
function* tarEntries(tar: Buffer): Generator<TarEntry> {
  let pos = 0
  let longName: string | null = null
  let paxPath: string | null = null
  let paxSize: number | null = null
  while (pos + BLOCK <= tar.length) {
    const header = tar.subarray(pos, pos + BLOCK)
    if (header.every((byte) => byte === 0)) return
    if (!checksumOk(header)) throw new RepoFetchError(UNREADABLE)
    const type = cString(header, 156, 1) || '0'
    const isMeta = type === 'x' || type === 'g' || type === 'L' || type === 'K'
    const size = !isMeta && paxSize !== null ? paxSize : parseOctal(header, 124, 12)
    const bodyStart = pos + BLOCK
    if (bodyStart + size > tar.length) throw new RepoFetchError(UNREADABLE)
    const body = tar.subarray(bodyStart, bodyStart + size)
    pos = bodyStart + Math.ceil(size / BLOCK) * BLOCK

    if (type === 'x') {
      const records = parsePax(body)
      paxPath = records.get('path') ?? null
      const declared = records.get('size')
      paxSize = declared !== undefined && /^\d+$/.test(declared) ? Number(declared) : null
    } else if (type === 'L') {
      longName = cString(body, 0, body.length)
    } else if (!isMeta) {
      // 'g' (global pax) and 'K' (GNU long link) are ignored: links are never followed.
      const prefix = cString(header, 345, 155)
      const base = cString(header, 0, 100)
      const ustarName = prefix ? `${prefix}/${base}` : base
      yield { path: paxPath ?? longName ?? ustarName, type, body }
      longName = null
      paxPath = null
      paxSize = null
    }
  }
  // Bytes left over that are not padding mean the tar was cut short.
  if (tar.subarray(pos).some((byte) => byte !== 0)) throw new RepoFetchError(UNREADABLE)
}

/** Splits a path into segments, or returns null when the path is not acceptable. */
function cleanSegments(path: string): string[] | null {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return null
  const raw = path.split('/')
  const segments = raw[raw.length - 1] === '' ? raw.slice(0, -1) : raw
  if (segments.length === 0 || segments.some((s) => s === '' || s === '.' || s === '..')) return null
  return segments
}

function isSkippedByName(relative: string[]): boolean {
  const name = relative[relative.length - 1] ?? ''
  if (relative.slice(0, -1).some((dir) => REPO_SKIP_DIRS.includes(dir))) return true
  if (REPO_LOCK_FILES.includes(name)) return true
  return name.endsWith('.min.js') || name.endsWith('.min.css')
}

function decodeFile(path: string, body: Buffer, maxFileBytes: number): RepoFile | null {
  if (body.length > maxFileBytes) return null
  if (body.subarray(0, BINARY_SCAN_BYTES).includes(0)) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return null
  }
  return { path, lines: text.split(/\r?\n/) }
}

function unpack(gz: Buffer, maxUnpackedBytes: number): Buffer {
  try {
    return gunzipSync(gz, { maxOutputLength: maxUnpackedBytes })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new RepoFetchError(TOO_LARGE)
    console.error('Repository archive could not be unzipped', err)
    throw new RepoFetchError(UNREADABLE)
  }
}

/**
 * Reads a GitHub tar.gz held in memory. Nothing is written to disk, links are never followed,
 * and only regular text files that pass the skip rules are kept.
 */
export function readArchive(gz: Buffer, limits: Partial<ArchiveLimits> = {}): ArchiveResult {
  const maxUnpackedBytes = limits.maxUnpackedBytes ?? REPO_MAX_UNPACKED_BYTES
  const maxFiles = limits.maxFiles ?? REPO_MAX_FILES
  const maxFileBytes = limits.maxFileBytes ?? REPO_MAX_FILE_BYTES

  const tar = unpack(gz, maxUnpackedBytes)
  const files: RepoFile[] = []
  let skipped = 0
  let truncated = false
  let top: string | null = null

  try {
    for (const entry of tarEntries(tar)) {
      const segments = cleanSegments(entry.path)
      if (segments === null) {
        skipped += 1
        continue
      }
      top ??= segments[0] ?? null
      const isFolder = entry.type === '5'
      if (segments[0] !== top || segments.length < 2) {
        // The top folder's own entry is not a skipped file; anything else outside it is.
        if (!(isFolder && segments.length === 1)) skipped += 1
        continue
      }
      if (isFolder) continue
      if (entry.type !== '0') {
        skipped += 1
        continue
      }
      const relative = segments.slice(1)
      const file = isSkippedByName(relative) ? null : decodeFile(relative.join('/'), entry.body, maxFileBytes)
      if (file === null) {
        skipped += 1
        continue
      }
      if (files.length >= maxFiles) {
        truncated = true
        break
      }
      files.push(file)
    }
  } catch (err) {
    if (err instanceof RepoFetchError) throw err
    console.error('Repository archive could not be read', err)
    throw new RepoFetchError(UNREADABLE)
  }
  return { files, skipped, truncated }
}
