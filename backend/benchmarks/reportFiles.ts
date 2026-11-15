/**
 * Where the report files go and how they are written: a name that never overwrites an earlier
 * report, claimed at the start of a run, and writes through a temporary file and a rename, so the
 * JSON on disk is always whole, even when the run is stopped half way.
 */
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

/** Writes the whole text to a temporary file next to the target, then renames it over the target. */
export async function writeAtomic(path: string, text: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, text, 'utf8')
  try {
    await rename(temporary, path)
  } catch (err) {
    await unlink(temporary).catch(() => undefined)
    throw err
  }
}

/** Writes a finished report under a free name: `<base>.md` and `<base>.json`. */
export async function writeReport(dir: string, baseName: string, report: BuiltReport): Promise<ReportPaths> {
  const paths = await reserveReportPaths(dir, baseName, report.json)
  await writeAtomic(paths.markdownPath, report.markdown)
  return paths
}
