// A small in-memory stand-in for the Supabase query builder: just the calls the mapping code makes.
// Tests mock '../config/supabase.js' with `supabase` from here and read or seed `tables` directly.

export type Row = Record<string, any>

export const tables: Record<string, Row[]> = {}
let nextId = 0

const ID_COLUMN: Record<string, string> = {
  Item_Mapping: 'mappingId',
  Suggestion_Decision: 'decisionId',
  Audit_Result: 'resultId',
}

export function resetTables(initial: Record<string, Row[]> = {}): void {
  for (const k of Object.keys(tables)) delete tables[k]
  nextId = 0
  Object.assign(tables, initial)
}

class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  private filters: ((r: Row) => boolean)[] = []
  private payload: any
  private opts: Row = {}
  private window: [number, number] | null = null
  private wantsOne = false
  private lenient = false

  constructor(private readonly table: string) {}

  select() { return this }
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

  private run(): { data: any; error: any } {
    const rows = (tables[this.table] ??= [])
    if (this.op === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r: Row) => this.withDefaults(r))
      rows.push(...list)
      return { data: list, error: null }
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
    if (this.wantsOne) {
      if (hit.length > 1) return { data: null, error: { message: 'more than one row' } }
      return { data: hit[0] ?? null, error: hit.length === 0 && !this.lenient ? { code: 'PGRST116', message: 'no single row' } : null }
    }
    return { data: hit, error: null }
  }

  then<A, B>(ok?: ((v: { data: any; error: any }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, bad)
  }
}

export const supabase = { from: (table: string) => new FakeQuery(table) }
