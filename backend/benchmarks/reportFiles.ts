/**
 * Where the report files go and how they are written: a name that never overwrites an earlier
 * report, claimed at the start of a run, and writes through a temporary file and a rename, so the
 * JSON on disk is always whole, even when the run is stopped half way.
 */
import { randomUUID } from 'node:crypto'
import { access, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuiltReport } from './report.js'

export interface ReportPaths {
  markdownPath: string
  jsonPath: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** `<local date>-<label>`, with the label cut down to lower-case letters, digits and dashes. */
export function reportBaseName(date: Date, label: string): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return `${day}-${slug || 'run'}`
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const isExists = (err: unknown): boolean => (err as { code?: unknown } | null)?.code === 'EEXIST'

/**
 * Picks `<base>`, or `<base>-2`, `-3` and so on when a report of that name exists, and claims it by
 * writing its JSON at once.
 */
export async function reserveReportPaths(dir: string, baseName: string, initialJson: string): Promise<ReportPaths> {
  await mkdir(dir, { recursive: true })
  for (let n = 1; ; n += 1) {
    const base = n === 1 ? baseName : `${baseName}-${n}`
    const markdownPath = join(dir, `${base}.md`)
    const jsonPath = join(dir, `${base}.json`)
    if (await exists(markdownPath)) continue
    try {
      await writeFile(jsonPath, initialJson, { encoding: 'utf8', flag: 'wx' })
    } catch (err) {
      if (isExists(err)) continue
      throw err
    }
    return { markdownPath, jsonPath }
  }
}

/** The writes still pending, by target: each waits for the one before it, so they land in the order made. */
const pending = new Map<string, Promise<void>>()

async function writeThenRename(path: string, text: string): Promise<void> {
  // Its own temporary name, so no two writes ever share one.
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, text, 'utf8')
  try {
    await rename(temporary, path)
  } catch (err) {
    await unlink(temporary).catch(() => undefined)
    throw err
  }
}

/**
 * Writes the whole text to a temporary file next to the target, then renames it over the target.
 * Writes to the same target run one after another, in the order they were made.
 */
export function writeAtomic(path: string, text: string): Promise<void> {
  const before = pending.get(path) ?? Promise.resolve()
  const mine = before.catch(() => undefined).then(() => writeThenRename(path, text))
  pending.set(path, mine)
  void mine
    .catch(() => undefined)
    .then(() => {
      if (pending.get(path) === mine) pending.delete(path)
    })
  return mine
}

/** Writes a finished report under a free name: `<base>.md` and `<base>.json`. */
export async function writeReport(dir: string, baseName: string, report: BuiltReport): Promise<ReportPaths> {
  const paths = await reserveReportPaths(dir, baseName, report.json)
  await writeAtomic(paths.markdownPath, report.markdown)
  return paths
}
