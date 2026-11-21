import { invalidateMappingCache } from '../../src/services/mappingCache.js'
// A small in-memory stand-in for the Supabase query builder: just the calls the mapping, database service and server code make.
// Tests mock src/config/supabase.js with `supabase` from here and read or seed `tables` directly.
// Embedded resources (`User(userName)` in a select) are not joined: seed the nested object on the row instead.

export type Row = Record<string, any>

export const tables: Record<string, Row[]> = {}
let nextId = 0

const ID_COLUMN: Record<string, string> = {
  Item_Mapping: 'mappingId',
  Suggestion_Decision: 'decisionId',
  Audit_Result: 'resultId',
  Audit_Project: 'projectId',
  Audit_Report: 'reportId',
  Checklist_Resolution: 'resolutionId',
  Project_Scope: 'id',
}

/** Unique keys checked on insert, as the database would: a duplicate answers Postgres error 23505. */
const UNIQUE_ON_INSERT: Record<string, string[]> = {
  User: ['userId'],
  Guideline: ['guidelineId'],
  Project_Member: ['projectId', 'userId'],
  Audit_Report: ['projectId'],
}

type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete'
type RpcHandler = (args: Row) => { data: any; error: any }

let failures: { table: string; op: Op | 'any'; error: Row }[] = []
let rpcHandlers: Record<string, RpcHandler> = {}

export function resetTables(initial: Record<string, Row[]> = {}): void {
  invalidateMappingCache()
  for (const k of Object.keys(tables)) delete tables[k]
  nextId = 0
  failures = []
  rpcHandlers = {}
  Object.assign(tables, initial)
}

/** The next query on `table` (of kind `op`, or of any kind) answers `error` instead of running. One use each. */
export function failNext(table: string, op: Op | 'any' = 'any', error: Row = { message: 'database unavailable' }): void {
  failures.push({ table, op, error })
}

/** What `supabase.rpc(name, args)` answers. An rpc without a handler answers an error. */
export function onRpc(name: string, handler: RpcHandler): void {
  rpcHandlers[name] = handler
}

function splitTopLevel(expr: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of expr) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** One PostgREST condition of an `or(...)` filter: `col.eq.value`, `col.in.(a,b)` or `col.is.null`. */
function orCondition(cond: string): (r: Row) => boolean {
  const [col, op, ...rest] = cond.split('.')
  const val = rest.join('.')
  if (op === 'eq') return (r) => String(r[col]) === val
  if (op === 'in') {
    const vals = val.replace(/^\(|\)$/g, '').split(',')
    return (r) => vals.includes(String(r[col]))
  }
  if (op === 'is') return (r) => (r[col] ?? null) === null
  throw new Error(`fakeSupabase: or() does not support "${op}"`)
}

class FakeQuery implements PromiseLike<{ data: any; error: any; count?: number }> {
  private op: Op = 'select'
  private filters: ((r: Row) => boolean)[] = []
  private payload: any
  private opts: Row = {}
  private window: [number, number] | null = null
  private wantsOne = false
  private lenient = false
  private counted = false
  private headOnly = false

  constructor(private readonly table: string) {}

  select(_cols?: string, opts: { count?: string; head?: boolean } = {}) {
    if (opts.count) this.counted = true
    if (opts.head) this.headOnly = true
    return this
  }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = rows; return this }
  upsert(rows: Row | Row[], opts: Row = {}) { this.op = 'upsert'; this.payload = rows; this.opts = opts; return this }
  update(values: Row) { this.op = 'update'; this.payload = values; return this }
  delete() { this.op = 'delete'; return this }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this }
  is(col: string, val: unknown) { this.filters.push((r) => (r[col] ?? null) === val); return this }
  in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this }
  gt(col: string, val: number) { this.filters.push((r) => r[col] > val); return this }
  not(col: string, op: string, val: unknown) {
    if (op === 'is') this.filters.push((r) => (r[col] ?? null) !== val)
    else if (op === 'like') {
      const prefix = String(val).replace(/%$/, '')
      this.filters.push((r) => !String(r[col] ?? '').startsWith(prefix))
    }
    return this
  }
  or(expr: string) {
    const conds = splitTopLevel(expr).map(orCondition)
    this.filters.push((r) => conds.some((c) => c(r)))
    return this
  }
  order() { return this }
  range(from: number, to: number) { this.window = [from, to]; return this }
  limit(count: number) { this.window = [0, count - 1]; return this }
  single() { this.wantsOne = true; return this }
  maybeSingle() { this.wantsOne = true; this.lenient = true; return this }

  private matching() {
    const rows = (tables[this.table] ??= [])
    return rows.filter((r) => this.filters.every((f) => f(r)))
  }

  private withDefaults(row: Row): Row {
    const out = { ...row }
    const idCol = ID_COLUMN[this.table]
    if (idCol && !out[idCol]) out[idCol] = `gen-${++nextId}`
    if (this.table === 'Item_Mapping' && !out.createdAt) out.createdAt = new Date(2026, 0, nextId + 1).toISOString()
    if (this.table === 'Audit_Result') out.evidenceCount = Array.isArray(out.evidenceImages) ? out.evidenceImages.length : 0
    return out
  }

  private duplicateOf(row: Row, rows: Row[]): boolean {
    const keys = UNIQUE_ON_INSERT[this.table]
    return !!keys && rows.some((e) => keys.every((k) => e[k] === row[k]))
  }

  private run(): { data: any; error: any; count?: number } {
    const failure = failures.findIndex((f) => f.table === this.table && (f.op === 'any' || f.op === this.op))
    if (failure >= 0) {
      const [{ error }] = failures.splice(failure, 1)
      return { data: null, error }
    }
    const rows = (tables[this.table] ??= [])
    if (this.op === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r: Row) => this.withDefaults(r))
      if (list.some((r: Row, i: number) => this.duplicateOf(r, [...rows, ...list.slice(0, i)]))) {
        return { data: null, error: { code: '23505', details: `Key already exists in ${this.table}.`, message: 'duplicate key value violates unique constraint' } }
      }
      rows.push(...list)
      return { data: this.wantsOne ? list[0] ?? null : list, error: null }
    }
    if (this.op === 'upsert') {
      const keys = String(this.opts.onConflict).split(',')
      const changed: Row[] = []
      for (const r of (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]) {
        const at = rows.findIndex((e) => keys.every((k) => e[k] === r[k]))
        if (at >= 0 && this.opts.ignoreDuplicates) continue
        if (at >= 0) {
          rows[at] = { ...rows[at], ...r }
          changed.push(rows[at])
          continue
        }
        const row = this.withDefaults(r)
        rows.push(row)
        changed.push(row)
      }
      return { data: changed, error: null }
    }
    if (this.op === 'update') {
      const hit = this.matching()
      hit.forEach((r) => Object.assign(r, this.payload))
      return { data: hit, error: null }
    }
    if (this.op === 'delete') {
      const hit = this.matching()
      tables[this.table] = rows.filter((r) => !hit.includes(r))
      return { data: hit, error: null }
    }
    let hit = this.matching()
    if (this.window) hit = hit.slice(this.window[0], this.window[1] + 1)
    if (this.counted) return { data: this.headOnly ? null : hit, error: null, count: hit.length }
    if (this.wantsOne) {
      if (hit.length > 1) return { data: null, error: { message: 'more than one row' } }
      return { data: hit[0] ?? null, error: hit.length === 0 && !this.lenient ? { code: 'PGRST116', message: 'no single row' } : null }
    }
    return { data: hit, error: null }
  }

  then<A, B>(ok?: ((v: { data: any; error: any; count?: number }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, bad)
  }
}

export const supabase = {
  from: (table: string) => new FakeQuery(table),
  rpc: async (name: string, args: Row = {}) => {
    const handler = rpcHandlers[name]
    return handler ? handler(args) : { data: null, error: { message: `function ${name} does not exist` } }
  },
}
