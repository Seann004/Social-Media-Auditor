/**
 * `merge`: combines benchmark reports, for example an app-only and a code-only run, into one report.
 * Every input must be a benchmark report of the same model, and a case found in two reports must be
 * the same case in both. A case's repeats are numbered on from one report to the next. No side effects.
 */
import type { ReportMeta } from './report.js'
import type { AppSetup, Answer, BenchmarkCase, CaseKind, CaseSource, ExpectedAnswer, RepeatRecord } from './types.js'

export type MergeArgs = { ok: true; files: string[]; label: string } | { ok: false; error: string }

/** Reads `<a.json> <b.json> ... --label <name>`. */
export function parseMergeArgs(argv: readonly string[]): MergeArgs {
  const files: string[] = []
  let label = 'merged'
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith('--')) {
      files.push(raw)
      continue
    }
    const eq = raw.indexOf('=')
    const flag = eq < 0 ? raw : raw.slice(0, eq)
    if (flag !== '--label') return { ok: false, error: `Unknown option for merge: ${flag}` }
    const value = eq < 0 ? argv[i + 1] : raw.slice(eq + 1)
    if (eq < 0) i += 1
    if (value === undefined || value.trim() === '' || value.startsWith('--')) return { ok: false, error: '--label needs a name' }
    label = value.trim()
  }
  if (files.length < 2) return { ok: false, error: 'merge needs at least two report files (.json).' }
  return { ok: true, files, label }
}

interface CaseRow {
  caseId: string
  source: CaseSource
  category?: string
  item: string
  expected: ExpectedAnswer
  alsoAcceptable: Answer[]
  hedges?: Answer[]
  why: string
  kinds: CaseKind[]
  app?: AppSetup | null
}

interface ReportJson {
  meta: ReportMeta
  cases: CaseRow[]
  records: RepeatRecord[]
}

export interface MergeInput {
  /** The file's name, as the report names it. */
  name: string
  text: string
}

export type Merged = { ok: true; meta: ReportMeta; cases: BenchmarkCase[]; records: RepeatRecord[] } | { ok: false; error: string }

function parseReport(text: string): ReportJson | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const v = value as Partial<ReportJson> | null
  const isReport = v !== null && typeof v === 'object' && typeof v.meta?.model === 'string' && Array.isArray(v.cases) && Array.isArray(v.records)
  return isReport ? (v as ReportJson) : null
}

function caseOf(row: CaseRow): BenchmarkCase {
  return {
    id: row.caseId,
    source: row.source,
    category: row.category ?? '',
    item: row.item,
    expected: row.expected,
    alsoAcceptable: [...row.alsoAcceptable],
    hedges: [...(row.hedges ?? [])],
    why: row.why,
    kinds: [...row.kinds],
    ...(row.app ? { app: row.app } : {}),
  }
}

const answersKey = (c: BenchmarkCase): string => JSON.stringify([c.expected, [...c.alsoAcceptable].sort(), [...(c.hedges ?? [])].sort()])

/** What differs between two versions of a case, or null when they are the same case. */
function difference(a: BenchmarkCase, b: BenchmarkCase): string | null {
  if (a.source !== b.source || a.item !== b.item) return 'items'
  if (answersKey(a) !== answersKey(b)) return 'expected answers'
  if (JSON.stringify(a.app ?? null) !== JSON.stringify(b.app ?? null)) return 'app setups'
  if (a.why !== b.why) return 'explanations'
  if (JSON.stringify([...a.kinds].sort()) !== JSON.stringify([...b.kinds].sort())) return 'kinds'
  return null
}

/** A reason the inputs (with distinct names) would count some repeats twice, or null. */
function duplicateInput(inputs: readonly MergeInput[], reports: { name: string; report: ReportJson }[]): string | null {
  const names = inputs.map((i) => i.name)
  for (let i = 0; i < inputs.length; i++) {
    const same = inputs.findIndex((other, j) => j > i && other.text === inputs[i].text)
    if (same >= 0) return `${inputs[i].name} and ${inputs[same].name} are the same report.`
  }
  for (const { name, report } of reports) {
    const inside = (report.meta.mergedFrom ?? []).find((source) => names.includes(source) && source !== name)
    if (inside !== undefined) return `${name} was merged from ${inside}, which is given too. Give each report once.`
  }
  return null
}

function mergedMeta(reports: { name: string; report: ReportJson }[], label: string, records: RepeatRecord[]): ReportMeta {
  const metas = reports.map((r) => r.report.meta)
  const perCase = new Map<string, number>()
  for (const r of records) perCase.set(r.caseId, (perCase.get(r.caseId) ?? 0) + 1)
  const commits = [...new Set(metas.flatMap((m) => (m.commit ? [m.commit] : [])))]
  const stops = reports.flatMap((r) => (r.report.meta.stoppedEarly ? [`${r.name}: ${r.report.meta.stoppedEarly}`] : []))
  return {
    startedAt: metas.map((m) => m.startedAt).sort()[0],
    label,
    model: metas[0].model,
    repeats: Math.max(0, ...perCase.values()),
    maxTokens: metas.reduce((total, m) => total + m.maxTokens, 0),
    commit: commits.length === 0 ? null : commits.join(', '),
    stoppedEarly: stops.length === 0 ? null : stops.join('; '),
    mergedFrom: reports.map((r) => r.name),
  }
}

export function mergeReports(inputs: readonly MergeInput[], label: string): Merged {
  const names = inputs.map((i) => i.name)
  const twice = names.find((name, i) => names.indexOf(name) !== i)
  if (twice !== undefined) return { ok: false, error: `${twice} is given twice.` }
  const reports: { name: string; report: ReportJson }[] = []
  for (const input of inputs) {
    const report = parseReport(input.text)
    if (report === null) return { ok: false, error: `${input.name} is not a benchmark report.` }
    reports.push({ name: input.name, report })
  }
  const duplicate = duplicateInput(inputs, reports)
  if (duplicate !== null) return { ok: false, error: duplicate }
  const models = new Set(reports.map((r) => r.report.meta.model))
  if (models.size > 1) {
    const list = reports.map((r) => `${r.name}: ${r.report.meta.model}`).join('; ')
    return { ok: false, error: `The reports used different models (${list}). Merge only reports of one model.` }
  }

  const cases = new Map<string, { c: BenchmarkCase; from: string }>()
  const repeatsSoFar = new Map<string, number>()
  const records: RepeatRecord[] = []
  for (const { name, report } of reports) {
    for (const row of report.cases) {
      const c = caseOf(row)
      const known = cases.get(c.id)
      const differs = known === undefined ? null : difference(known.c, c)
      if (known !== undefined && differs !== null) {
        return { ok: false, error: `Case ${c.id} is not the same in ${known.from} and ${name} (its ${differs} differ). Merge only reports of the same cases.` }
      }
      if (known === undefined) cases.set(c.id, { c, from: name })
    }
    const offsets = new Map(repeatsSoFar)
    for (const r of [...report.records].sort((a, b) => a.repeat - b.repeat)) {
      records.push({ ...r, repeat: r.repeat + (offsets.get(r.caseId) ?? 0) })
      repeatsSoFar.set(r.caseId, Math.max(repeatsSoFar.get(r.caseId) ?? 0, r.repeat + (offsets.get(r.caseId) ?? 0)))
    }
  }
  return { ok: true, meta: mergedMeta(reports, label, records), cases: [...cases.values()].map((v) => v.c), records }
}
