import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuditData, type AuditDb } from './auditData.js'

interface Img {
  url: string
  name: string
}
interface Row {
  resultId: string
  projectId: string
  itemId: string
  userId: string
  result: string
  notes: string | null
  findings: string | null
  evidenceImages: Img[] | null
}

const row = (userId: string, over: Partial<Row> = {}): Row => ({
  resultId: `r-${userId}`, projectId: 'p1', itemId: 'i1', userId, result: 'non_compliant',
  notes: `notes of ${userId}`, findings: null, evidenceImages: [], ...over,
})

/** Just enough of the client: select().eq().eq() and update().eq().eq(), both awaitable. */
function world(initial: Row[]) {
  const rows = initial
  const log: string[] = []
  const updates: Partial<Row>[] = []
  let updateError: { message: string } | null = null
  const client = {
    from(table: string) {
      if (table !== 'Audit_Result') throw new Error(`unexpected table ${table}`)
      const filters: [string, unknown][] = []
      const matching = () => rows.filter((r) => filters.every(([c, v]) => (r as never)[c] === v))
      const chain = {
        eq(c: string, v: unknown) { filters.push([c, v]); return chain },
        then(resolve: (v: unknown) => void) {
          log.push('select')
          resolve({ data: structuredClone(matching()), error: null })
        },
      }
      return {
        select: (columns: string) => { log.push(`columns:${columns}`); return chain },
        update(patch: Partial<Row>) {
          const upd = {
            eq(c: string, v: unknown) { filters.push([c, v]); return upd },
            then(resolve: (v: unknown) => void) {
              log.push('update')
              updates.push(patch)
              if (!updateError) for (const r of matching()) Object.assign(r, structuredClone(patch))
              resolve({ error: updateError })
            },
          }
          return upd
        },
      }
    },
  }
  const upsert = vi.fn(async (projectId: string, itemId: string, userId: string, guidelineId: string, result: string, notes: string) => {
    log.push('upsert')
    const existing = rows.find((r) => r.userId === userId && r.itemId === itemId)
    if (existing) Object.assign(existing, { result, notes: notes || null })
    else rows.push({ ...row(userId), projectId, itemId, result, notes: notes || null, resultId: `r-${userId}` })
    return { answered: 0, compliant: 0, nonCompliant: 0, notApplicable: 0, percentage: 0, total: 0 }
  })
  const audit = createAuditData({
    db: async () => ({ upsertAuditResult: upsert }) as unknown as AuditDb,
    client: () => client as never,
  })
  return { rows, log, updates, upsert, audit, failUpdate: () => { updateError = { message: 'update refused' } } }
}

const base = { projectId: 'p1', itemId: 'i1', guidelineId: 'g1', userId: 'u1', result: 'compliant' as const }
const ai = (n: number, url = `https://signed/${n}?t=1`): Img => ({ url, name: `AI evidence hl-${n}.jpg` })

describe('applyAnswer', () => {
  let w: ReturnType<typeof world>
  beforeEach(() => { w = world([row('u1'), row('u2')]) })

  it('upserts with the deciding auditor\'s notes, then sets the result on every row for the item', async () => {
    await w.audit.applyAnswer(base)
    expect(w.upsert).toHaveBeenCalledWith('p1', 'i1', 'u1', 'g1', 'compliant', 'notes of u1')
    expect(w.rows.map((r) => r.result)).toEqual(['compliant', 'compliant'])
    expect(w.rows.map((r) => r.notes)).toEqual(['notes of u1', 'notes of u2'])
    expect(w.log.filter((l) => l === 'update')).toHaveLength(1)
    expect(w.log.indexOf('upsert')).toBeLessThan(w.log.indexOf('update'))
  })

  it('reads only the columns it needs', async () => {
    await w.audit.applyAnswer(base)
    const columns = w.log.find((l) => l.startsWith('columns:'))
    expect(columns).not.toContain('*')
  })

  it('creates the deciding auditor\'s row when they have none', async () => {
    const w2 = world([row('u2', { findings: 'seen by u2' })])
    const out = await w2.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI' })
    expect(w2.rows.map((r) => r.userId).sort()).toEqual(['u1', 'u2'])
    expect(w2.rows.every((r) => r.result === 'compliant' && r.findings === 'seen by u2')).toBe(true)
    expect(out.findings).toBe('seen by u2')
  })

  it('accept fills empty findings with the fallback on every row', async () => {
    const out = await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI reason' })
    expect(w.rows.map((r) => r.findings)).toEqual(['AI reason', 'AI reason'])
    expect(out).toEqual({ itemId: 'i1', status: 'compliant', findings: 'AI reason', evidenceImages: [] })
  })

  it('accept keeps findings an auditor already wrote, and ignores the fallback', async () => {
    w.rows[0].findings = 'My own findings'
    await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI reason' })
    expect(w.rows.map((r) => r.findings)).toEqual(['My own findings', 'My own findings'])
  })

  it('two auditors\' different findings are both kept, the deciding auditor\'s first, equal text once', async () => {
    w.rows[0].findings = 'From u1'
    w.rows[1].findings = 'From u2'
    await w.audit.applyAnswer({ ...base, userId: 'u2', findingsIfEmpty: 'AI' })
    expect(w.rows.map((r) => r.findings)).toEqual(['From u2\n\nFrom u1', 'From u2\n\nFrom u1'])
    await w.audit.applyAnswer({ ...base, userId: 'u2', findingsIfEmpty: 'AI' })
    expect(w.rows[0].findings).toBe('From u2\n\nFrom u1')
  })

  it('accept keeps existing notes', async () => {
    await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI' })
    expect(w.rows.map((r) => r.notes)).toEqual(['notes of u1', 'notes of u2'])
  })

  it('accept adds new photos after the existing ones, on every row', async () => {
    const own: Img = { url: 'data:image/png;base64,AAA', name: 'mine.png' }
    w.rows[0].evidenceImages = [own]
    const out = await w.audit.applyAnswer({ ...base, addImages: [ai(1), ai(2)] })
    expect(w.rows.map((r) => r.evidenceImages)).toEqual([[own, ai(1), ai(2)], [own, ai(1), ai(2)]])
    expect(out.evidenceImages).toEqual([own, ai(1), ai(2)])
  })

  it('accepting twice does not add a picture again, though its link differs', async () => {
    await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', addImages: [ai(1), ai(2)] })
    await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', addImages: [ai(1, 'https://signed/1?t=2'), ai(2, 'https://signed/2?t=2')] })
    expect(w.rows[0].evidenceImages).toEqual([ai(1), ai(2)])
    expect(w.rows[0].findings).toBe('AI')
  })

  it('a photo only on another auditor\'s row survives and is shown on every row', async () => {
    const theirs: Img = { url: 'data:image/png;base64,BBB', name: 'theirs.png' }
    w.rows[1].evidenceImages = [theirs]
    await w.audit.applyAnswer({ ...base, addImages: [ai(1)] })
    expect(w.rows.map((r) => r.evidenceImages)).toEqual([[theirs, ai(1)], [theirs, ai(1)]])
  })

  it('the same existing photo on two rows is kept once', async () => {
    const shared: Img = { url: 'data:image/png;base64,CCC', name: 'shared.png' }
    w.rows[0].evidenceImages = [shared]
    w.rows[1].evidenceImages = [shared]
    await w.audit.applyAnswer({ ...base, addImages: [] })
    expect(w.rows[0].evidenceImages).toEqual([shared])
  })

  it('override changes only the result: each row keeps its own findings and photos', async () => {
    const mine: Img = { url: 'data:x', name: 'mine.png' }
    w.rows[0].findings = 'F1'
    w.rows[0].evidenceImages = [mine]
    w.rows[1].findings = 'F2'
    const out = await w.audit.applyAnswer({ ...base, result: 'non_compliant' })
    expect(w.updates[0]).toEqual({ result: 'non_compliant' })
    expect(w.rows.map((r) => r.findings)).toEqual(['F1', 'F2'])
    expect(w.rows.map((r) => r.evidenceImages)).toEqual([[mine], []])
    expect(out).toMatchObject({ status: 'non_compliant', findings: 'F1', evidenceImages: [mine] })
  })

  it('throws when the update fails', async () => {
    w.failUpdate()
    await expect(w.audit.applyAnswer(base)).rejects.toThrow(/update refused/)
  })
})
