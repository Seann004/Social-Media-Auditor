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
function world(initial: Row[], hooks: { duringUpsert?: (rows: Row[]) => void; failRead?: boolean; failUpdateNumbers?: number[] } = {}) {
  const rows = initial
  const log: string[] = []
  const updates: Partial<Row>[] = []
  let updateError: { message: string } | null = null
  let updateCount = 0
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
        select: (columns: string) => {
          log.push(`columns:${columns}`)
          if (hooks.failRead) {
            return { eq: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'read refused' } }) }) }
          }
          return chain
        },
        update(patch: Partial<Row>) {
          const upd = {
            eq(c: string, v: unknown) { filters.push([c, v]); return upd },
            then(resolve: (v: unknown) => void) {
              log.push('update')
              updateCount += 1
              const refused = hooks.failUpdateNumbers?.includes(updateCount) ? { message: 'update refused' } : null
              updates.push(patch)
              if (!updateError && !refused) for (const r of matching()) Object.assign(r, structuredClone(patch))
              resolve({ error: updateError ?? refused })
            },
          }
          return upd
        },
      }
    },
  }
  const upsert = vi.fn(async (projectId: string, itemId: string, userId: string, guidelineId: string, result: string, notes: string) => {
    log.push('upsert')
    const existing = rows.find((r) => r.userId === userId && r.itemId === itemId && r.projectId === projectId)
    if (existing) Object.assign(existing, { result, notes: notes || null })
    else rows.push({ ...row(userId), projectId, itemId, result, notes: notes || null, resultId: `r-${userId}` })
    hooks.duringUpsert?.(rows)
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

  // Photos are shown per auditor: a decision never adds or copies photos between rows.
  it('accept adds new photos after the deciding auditor own ones, on their row only', async () => {
    const own: Img = { url: 'data:image/png;base64,AAA', name: 'mine.png' }
    w.rows[0].evidenceImages = [own]
    const out = await w.audit.applyAnswer({ ...base, addImages: [ai(1), ai(2)] })
    expect(w.rows.map((r) => r.evidenceImages)).toEqual([[own, ai(1), ai(2)], []])
    expect(out.evidenceImages).toEqual([own, ai(1), ai(2)])
  })

  it('accept never writes photos to every row of the item', async () => {
    await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', addImages: [ai(1)] })
    const itemWide = w.updates.filter((patch) => 'result' in patch)
    expect(itemWide.length).toBeGreaterThan(0)
    expect(itemWide.every((patch) => !('evidenceImages' in patch))).toBe(true)
  })

  it('accept does not add an AI picture that another auditor row already has', async () => {
    w.rows[1].evidenceImages = [ai(1)]
    const out = await w.audit.applyAnswer({ ...base, addImages: [ai(1, 'https://signed/1?t=9'), ai(2)] })
    expect(w.rows.map((r) => r.evidenceImages)).toEqual([[ai(2)], [ai(1)]])
    expect(out.evidenceImages).toEqual([ai(2)])
  })

  it('accepting twice does not add a picture again, though its link differs', async () => {
    await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', addImages: [ai(1), ai(2)] })
    await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', addImages: [ai(1, 'https://signed/1?t=2'), ai(2, 'https://signed/2?t=2')] })
    expect(w.rows[0].evidenceImages).toEqual([ai(1), ai(2)])
    expect(w.rows[0].findings).toBe('AI')
  })

  it('a photo only on another auditor\'s row stays on that row only', async () => {
    const theirs: Img = { url: 'data:image/png;base64,BBB', name: 'theirs.png' }
    w.rows[1].evidenceImages = [theirs]
    await w.audit.applyAnswer({ ...base, addImages: [ai(1)] })
    expect(w.rows.map((r) => r.evidenceImages)).toEqual([[ai(1)], [theirs]])
  })

  it('the same existing photo on two rows stays once on each', async () => {
    const shared: Img = { url: 'data:image/png;base64,CCC', name: 'shared.png' }
    w.rows[0].evidenceImages = [shared]
    w.rows[1].evidenceImages = [shared]
    await w.audit.applyAnswer({ ...base, addImages: [] })
    expect(w.rows.map((r) => r.evidenceImages)).toEqual([[shared], [shared]])
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

  describe('typed text that travels with the decision', () => {
    it('notes given go to the upsert instead of the stored notes (also when empty)', async () => {
      await w.audit.applyAnswer({ ...base, notes: 'typed note' })
      expect(w.upsert).toHaveBeenLastCalledWith('p1', 'i1', 'u1', 'g1', 'compliant', 'typed note')
      await w.audit.applyAnswer({ ...base, notes: '' })
      expect(w.upsert).toHaveBeenLastCalledWith('p1', 'i1', 'u1', 'g1', 'compliant', '')
    })

    it('a first answer by an auditor with no row keeps the note they typed', async () => {
      const w2 = world([row('u2')])
      await w2.audit.applyAnswer({ ...base, notes: 'first note' })
      expect(w2.rows.find((r) => r.userId === 'u1')?.notes).toBe('first note')
    })

    it('accept: typed findings come first in the merge, replacing the auditor own stored text', async () => {
      w.rows[0].findings = 'old own'
      w.rows[1].findings = 'From u2'
      const out = await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', typedFindings: 'typed' })
      expect(w.rows.map((r) => r.findings)).toEqual(['typed\n\nFrom u2', 'typed\n\nFrom u2'])
      expect(out.findings).toBe('typed\n\nFrom u2')
    })

    it('accept by an auditor with no row: the typed text is kept, not the fallback, and not lost', async () => {
      const w2 = world([row('u2')])
      const out = await w2.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', typedFindings: 'typed' })
      expect(out.findings).toBe('typed')
      expect(w2.rows.map((r) => r.findings)).toEqual(['typed', 'typed'])
    })

    it('accept: blank typed findings are ignored', async () => {
      w.rows[0].findings = 'own'
      await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', typedFindings: '   ' })
      expect(w.rows.map((r) => r.findings)).toEqual(['own', 'own'])
    })

    it('override: typed findings go to the deciding auditor own row only', async () => {
      w.rows[0].findings = 'old own'
      w.rows[1].findings = 'From u2'
      const out = await w.audit.applyAnswer({ ...base, result: 'non_compliant', typedFindings: 'typed' })
      expect(w.rows.map((r) => r.findings)).toEqual(['typed', 'From u2'])
      expect(w.rows.map((r) => r.result)).toEqual(['non_compliant', 'non_compliant'])
      expect(out.findings).toBe('typed')
    })

    it('override by an auditor with no row: their new row gets the text, other rows stay as they were', async () => {
      const w2 = world([row('u2', { findings: 'From u2' })])
      const out = await w2.audit.applyAnswer({ ...base, result: 'non_compliant', typedFindings: 'typed' })
      expect(w2.rows.find((r) => r.userId === 'u1')?.findings).toBe('typed')
      expect(w2.rows.find((r) => r.userId === 'u2')?.findings).toBe('From u2')
      expect(out.findings).toBe('typed')
    })

    it('override: blank typed findings leave everything as before', async () => {
      w.rows[0].findings = 'own'
      await w.audit.applyAnswer({ ...base, result: 'non_compliant', typedFindings: ' ' })
      expect(w.rows.map((r) => r.findings)).toEqual(['own', null])
    })
  })

  it('throws when the update fails', async () => {
    w.failUpdate()
    await expect(w.audit.applyAnswer(base)).rejects.toThrow(/update refused/)
  })

  it('leaves other items and other projects untouched, whatever the call', async () => {
    const otherItem = row('u1', { itemId: 'i2', resultId: 'x-item', result: 'non_compliant', findings: 'keep', evidenceImages: [{ url: 'u', name: 'n' }] })
    const otherProject = row('u1', { projectId: 'p2', resultId: 'x-proj', result: 'non_compliant', findings: 'keep2' })
    const w2 = world([row('u1'), row('u2', { findings: 'F2' }), otherItem, otherProject])
    const before = structuredClone([otherItem, otherProject])
    await w2.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', addImages: [ai(1)] })
    await w2.audit.applyAnswer({ ...base, result: 'partially' })
    expect([w2.rows[2], w2.rows[3]]).toEqual(before)
    expect(w2.rows[0].findings).toBe('F2')
  })

  it('same-named photos with different links on two rows each stay on their own row', async () => {
    const a: Img = { url: 'data:image/png;base64,AAA', name: 'photo.png' }
    const b: Img = { url: 'data:image/png;base64,BBB', name: 'photo.png' }
    w.rows[0].evidenceImages = [a]
    w.rows[1].evidenceImages = [b]
    await w.audit.applyAnswer({ ...base, addImages: [] })
    expect(w.rows.map((r) => r.evidenceImages)).toEqual([[a], [b]])
  })

  it('handles rows whose photos are null, and treats whitespace-only findings as empty', async () => {
    w.rows[0].evidenceImages = null
    w.rows[0].findings = '   '
    w.rows[1].evidenceImages = null
    const out = await w.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', addImages: [ai(1)] })
    expect(out.findings).toBe('AI')
    expect(w.rows[0].evidenceImages).toEqual([ai(1)])
  })

  it('does not write when the read fails, and does not upsert', async () => {
    const w2 = world([row('u1')], { failRead: true })
    await expect(w2.audit.applyAnswer(base)).rejects.toThrow(/read refused/)
    expect(w2.upsert).not.toHaveBeenCalled()
    expect(w2.updates).toHaveLength(0)
  })

  it('does not update when the upsert fails', async () => {
    w.upsert.mockRejectedValueOnce(new Error('upsert refused'))
    await expect(w.audit.applyAnswer(base)).rejects.toThrow(/upsert refused/)
    expect(w.updates).toHaveLength(0)
  })

  it('without the service key it rejects and upserts nothing', async () => {
    const upsert = vi.fn()
    const audit = createAuditData({ db: async () => ({ upsertAuditResult: upsert }) as unknown as AuditDb, client: () => null })
    await expect(audit.applyAnswer(base)).rejects.toThrow(/service/i)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('accept keeps findings and a photo another auditor saved while the upsert ran', async () => {
    const late: Img = { url: 'data:late', name: 'late.png' }
    const w2 = world([row('u1'), row('u2')], {
      duringUpsert: (rows) => {
        const u2 = rows.find((r) => r.userId === 'u2')!
        u2.findings = 'Saved during the upsert'
        u2.evidenceImages = [late]
      },
    })
    await w2.audit.applyAnswer({ ...base, findingsIfEmpty: 'AI', addImages: [ai(1)] })
    expect(w2.rows.map((r) => r.findings)).toEqual(['Saved during the upsert', 'Saved during the upsert'])
    expect(w2.rows.map((r) => r.evidenceImages)).toEqual([[ai(1)], [late]])
  })

  describe('override by an auditor with no row of their own', () => {
    const photo: Img = { url: 'data:p', name: 'p.png' }

    it('gives the new row the findings but no copied photos, and leaves other rows alone', async () => {
      const w2 = world([row('u2', { findings: 'F2', evidenceImages: [photo] }), row('u3', { findings: 'F3' })])
      const out = await w2.audit.applyAnswer({ ...base, result: 'partially' })
      const byUser = Object.fromEntries(w2.rows.map((r) => [r.userId, r]))
      expect(byUser.u1).toMatchObject({ result: 'partially', findings: 'F2\n\nF3', evidenceImages: [] })
      expect(byUser.u2).toMatchObject({ result: 'partially', findings: 'F2', evidenceImages: [photo] })
      expect(byUser.u3).toMatchObject({ result: 'partially', findings: 'F3', evidenceImages: [] })
      expect(out).toMatchObject({ status: 'partially', findings: 'F2\n\nF3', evidenceImages: [] })
    })

    it('copies nothing when the other rows hold only photos', async () => {
      const w2 = world([row('u2', { evidenceImages: [photo] })])
      const out = await w2.audit.applyAnswer({ ...base, result: 'partially' })
      expect(w2.rows.find((r) => r.userId === 'u1')).toMatchObject({ result: 'partially', findings: null, evidenceImages: [] })
      expect(out.evidenceImages).toEqual([])
    })

    it('uses what is on the rows after the upsert, not before it', async () => {
      const w2 = world([row('u2')], { duringUpsert: (rows) => { rows.find((r) => r.userId === 'u2')!.findings = 'late' } })
      await w2.audit.applyAnswer({ ...base, result: 'partially' })
      expect(w2.rows.find((r) => r.userId === 'u1')?.findings).toBe('late')
    })

    it('a retry after the merge update failed still fills the empty row', async () => {
      const w2 = world([row('u2', { findings: 'F2', evidenceImages: [photo] })], { failUpdateNumbers: [2] })
      await expect(w2.audit.applyAnswer({ ...base, result: 'partially' })).rejects.toThrow(/update refused/)
      expect(w2.rows.find((r) => r.userId === 'u1')?.findings).toBeNull()
      await w2.audit.applyAnswer({ ...base, result: 'partially' })
      const mine = w2.rows.find((r) => r.userId === 'u1')
      expect(mine).toMatchObject({ result: 'partially', findings: 'F2', evidenceImages: [] })
      expect(w2.rows.find((r) => r.userId === 'u2')).toMatchObject({ findings: 'F2', evidenceImages: [photo] })
    })

    it.each([
      ['only findings', { findings: 'Mine' }],
      ['only photos', { evidenceImages: [{ url: 'data:m', name: 'm.png' }] }],
    ])('an existing row holding %s is left alone', async (_n, own) => {
      const w2 = world([row('u1', own), row('u2', { findings: 'F2', evidenceImages: [photo] })])
      await w2.audit.applyAnswer({ ...base, result: 'partially' })
      const mine = w2.rows.find((r) => r.userId === 'u1')!
      expect(mine.findings).toBe(own.findings ?? null)
      expect(mine.evidenceImages).toEqual(own.evidenceImages ?? [])
    })

    it('an auditor whose row is empty gets the findings of the item too', async () => {
      const w2 = world([row('u1'), row('u2', { findings: 'F2' })])
      await w2.audit.applyAnswer({ ...base, result: 'partially' })
      expect(w2.rows.map((r) => r.findings)).toEqual(['F2', 'F2'])
    })
  })
})
