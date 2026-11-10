/** Local search over the files of a repository: picks the code pieces that may answer a checklist item. */
import { MAX_CHARS_PER_PASSAGE, REPO_LINES_AROUND, REPO_MAX_PIECES_PER_ITEM } from './config.js'
import type { PieceDraft, RepoFile, SearchTerms } from './repoTypes.js'

const COMMENT_STARTS = ['//', '#', '/*', '*', '*/', '<!--', '--', ';']
const DOCS_EXTENSIONS = ['.md', '.mdx', '.txt', '.rst']
const DOCS_OR_TEST_SEGMENTS = new Set(['docs', 'doc', 'test', 'tests', '__tests__', 'spec'])
const LOCALE_SEGMENTS = new Set(['locales', 'locale', 'i18n', 'l10n', 'lang', 'langs', 'translations'])
const LOCALE_EXTENSIONS = ['.po', '.pot', '.xliff', '.xlf', '.strings']
/** Pieces one folder (parent directory) may give per call, so one folder of look-alike files cannot fill the list. */
const MAX_PIECES_PER_FOLDER = 2
const CODE_CHAR_BUDGET = MAX_CHARS_PER_PASSAGE - 200
const PER_WORD_LINE_CAP = 5
const POINTS_PER_WORD_IN_PATH = 2
const POINTS_PER_HINT_IN_PATH = 3

export function pieceKey(d: Pick<PieceDraft, 'path' | 'startLine' | 'endLine'>): string {
  return `${d.path}:${d.startLine}-${d.endLine}`
}

export function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t === '' || COMMENT_STARTS.some((start) => t.startsWith(start))
}

export function isDocsOrTestPath(path: string): boolean {
  const lower = path.toLowerCase()
  if (DOCS_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true
  const segments = lower.split('/')
  const fileName = segments[segments.length - 1] ?? ''
  if (fileName.includes('.test.') || fileName.includes('.spec.')) return true
  return segments.slice(0, -1).some((s) => DOCS_OR_TEST_SEGMENTS.has(s))
}

/** A translation file: a folder named like locales or i18n, or a translation file extension. */
export function isLocalePath(path: string): boolean {
  const lower = path.toLowerCase()
  if (LOCALE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true
  return lower.split('/').slice(0, -1).some((s) => LOCALE_SEGMENTS.has(s))
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/**
 * Locale files crowd out code because they repeat the same words in many languages: they are dropped
 * unless named, or unless no other file matches at all (so a translations-only repository still gets an answer).
 */
function withoutLocales(hits: FileHit[], named: ReadonlySet<string>): FileHit[] {
  const codeMatches = hits.some((h) => !isLocalePath(h.file.path))
  return codeMatches ? hits.filter((h) => !isLocalePath(h.file.path) || named.has(h.file.path)) : hits
}

interface Window {
  start: number // 0-based, inclusive
  end: number // 0-based, inclusive
  firstMatch: number // 0-based line of the first matching line
  distinct: number
  total: number
}

interface FileHit {
  file: RepoFile
  score: number
  windows: Window[] // best first
}

function cleanList(list: string[]): string[] {
  return list.map((s) => s.trim().toLowerCase()).filter((s) => s !== '')
}

/** A line holding at least one search word, with the indexes of the words it holds. */
interface LineMatch {
  line: number // 0-based
  words: number[]
}

interface FileMatches {
  matches: LineMatch[] // by line, ascending
  linesPerWord: number[] // for each word, how many lines hold it
}

/** Counts the newlines in text[from, to). */
function countNewlines(text: string, from: number, to: number): number {
  let count = 0
  for (let at = text.indexOf('\n', from); at !== -1 && at < to; at = text.indexOf('\n', at + 1)) count += 1
  return count
}

/** The 0-based lines that hold word, read from the file's lower-cased text. */
function linesHolding(lower: string, word: string): number[] {
  const found: number[] = []
  if (word.includes('\n')) return found // a word never spans two lines
  let line = 0
  let scanned = 0
  let at = lower.indexOf(word)
  while (at !== -1) {
    line += countNewlines(lower, scanned, at)
    found.push(line)
    const nextLine = lower.indexOf('\n', at)
    if (nextLine === -1) break
    line += 1
    scanned = nextLine + 1
    at = lower.indexOf(word, scanned)
  }
  return found
}

/** Only the lines that match: the file's text is lower-cased once, and no array is built per line. */
function matchLines(lines: string[], words: string[]): FileMatches {
  const lower = lines.join('\n').toLowerCase()
  const byLine = new Map<number, number[]>()
  const linesPerWord = words.map((word, i) => {
    const found = linesHolding(lower, word)
    for (const line of found) byLine.set(line, [...(byLine.get(line) ?? []), i])
    return found.length
  })
  const matches = [...byLine.entries()]
    .map(([line, hit]) => ({ line, words: hit }))
    .sort((a, b) => a.line - b.line)
  return { matches, linesPerWord }
}

function buildWindows(matches: LineMatch[], lineCount: number): Window[] {
  const spans: Array<{ start: number; end: number; firstMatch: number; distinct: Set<number>; total: number }> = []
  for (const { line, words } of matches) {
    const start = Math.max(0, line - REPO_LINES_AROUND)
    const end = Math.min(lineCount - 1, line + REPO_LINES_AROUND)
    const last = spans[spans.length - 1]
    if (last && start <= last.end + 1) {
      spans[spans.length - 1] = {
        ...last,
        end: Math.max(last.end, end),
        distinct: new Set([...last.distinct, ...words]),
        total: last.total + words.length,
      }
    } else {
      spans.push({ start, end, firstMatch: line, distinct: new Set(words), total: words.length })
    }
  }
  const windows = spans.map((s) => ({ start: s.start, end: s.end, firstMatch: s.firstMatch, distinct: s.distinct.size, total: s.total }))
  return windows.sort((a, b) => b.distinct - a.distinct || b.total - a.total || a.start - b.start)
}

function scoreFile(file: RepoFile, linesPerWord: number[], words: string[], hints: string[]): number {
  const path = file.path.toLowerCase()
  let score = 0
  words.forEach((w, i) => {
    score += Math.min(linesPerWord[i] ?? 0, PER_WORD_LINE_CAP)
    if (path.includes(w)) score += POINTS_PER_WORD_IN_PATH
  })
  for (const h of hints) if (path.includes(h)) score += POINTS_PER_HINT_IN_PATH
  return score
}

function toHit(file: RepoFile, words: string[], hints: string[], named: ReadonlySet<string>): FileHit | null {
  const { matches, linesPerWord } = matchLines(file.lines, words)
  const windows = buildWindows(matches, file.lines.length)
  const score = scoreFile(file, linesPerWord, words, hints)
  if (windows.length > 0) return { file, score, windows }
  if (!named.has(file.path) || file.lines.length === 0) return null
  const end = Math.min(file.lines.length - 1, 2 * REPO_LINES_AROUND)
  return { file, score, windows: [{ start: 0, end, firstMatch: 0, distinct: 0, total: 0 }] }
}

/** Joins lines[start..end]; narrows one line at a time from the edge farther from the first match until it fits. */
function toDraft(file: RepoFile, w: Window): PieceDraft {
  let { start, end } = w
  let size = 0
  for (let i = start; i <= end; i++) size += (file.lines[i]?.length ?? 0) + 1
  size -= 1
  while (size > CODE_CHAR_BUDGET && start < end) {
    if (w.firstMatch - start > end - w.firstMatch) {
      size -= (file.lines[start]?.length ?? 0) + 1
      start++
    } else {
      size -= (file.lines[end]?.length ?? 0) + 1
      end--
    }
  }
  const code = file.lines.slice(start, end + 1).join('\n').slice(0, CODE_CHAR_BUDGET)
  return { path: file.path, startLine: start + 1, endLine: end + 1, code }
}

export function findPieces(
  files: RepoFile[],
  terms: SearchTerms,
  opts: { max?: number; exclude?: ReadonlySet<string> } = {},
): PieceDraft[] {
  const max = opts.max ?? REPO_MAX_PIECES_PER_ITEM
  const exclude = opts.exclude ?? new Set<string>()
  const words = cleanList(terms.words)
  const hints = cleanList(terms.pathHints)
  const named = new Set(terms.paths)

  const matched = files.map((f) => toHit(f, words, hints, named)).filter((h): h is FileHit => h !== null)
  const hits = withoutLocales(matched, named).sort(
    (a, b) => b.score - a.score || (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0),
  )

  const pieces: PieceDraft[] = []
  let perFolder: ReadonlyMap<string, number> = new Map()
  const rounds = Math.max(0, ...hits.map((h) => h.windows.length))
  for (let round = 0; round < rounds && pieces.length < max; round++) {
    for (const hit of hits) {
      const window = hit.windows[round]
      if (!window) continue
      const folder = folderOf(hit.file.path)
      const taken = perFolder.get(folder) ?? 0
      if (taken >= MAX_PIECES_PER_FOLDER) continue
      const draft = toDraft(hit.file, window)
      if (exclude.has(pieceKey(draft))) continue
      pieces.push(draft)
      perFolder = new Map(perFolder).set(folder, taken + 1)
      if (pieces.length >= max) break
    }
  }
  return pieces
}
