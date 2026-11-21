import { beforeEach, describe, expect, it, vi } from 'vitest'
import { failNext, resetTables, tables } from '../../helpers/fakeSupabase.js'
import { answer, coreWorld, G, GI1, id, LI1, LOCKED, P, PG, PI1, PI2, U } from '../../fixtures/coreWorld.js'

vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

const db = await import('../../../src/services/dbService.js')

beforeEach(() => { resetTables(coreWorld()) })

describe('upsertAuditResult and fetchAuditResultStatus', () => {
  it('inserts the first answer and updates it after, one row per auditor and item', async () => {
    expect(await db.fetchAuditResultStatus(P, PI1, U.aud)).toBeNull()
    await db.upsertAuditResult(P, PI1, U.aud, 'ignored', 'compliant')
    await db.upsertAuditResult(P, PI1, U.aud2, PG, 'partially', 'half')
    await db.upsertAuditResult(P, PI1, U.aud, PG, 'non_compliant', 'changed my mind')
    expect(tables.Audit_Result).toHaveLength(2)
    expect(await db.fetchAuditResultStatus(P, PI1, U.aud)).toBe('non_compliant')
    expect(tables.Audit_Result.find((r) => r.userId === U.aud)).toMatchObject({ guidelineId: PG, notes: 'changed my mind' })
  })

  it('refuses a locked audit and an item of another project', async () => {
    await expect(db.upsertAuditResult(LOCKED, LI1, U.aud, PG, 'compliant')).rejects.toBeInstanceOf(db.EditLockedError)
    await expect(db.upsertAuditResult(P, LI1, U.aud, PG, 'compliant')).rejects.toBeInstanceOf(db.ResultNotFoundError)
    expect(tables.Audit_Result).toEqual([])
  })

  it('throws when a step fails', async () => {
    failNext('Audit_Result', 'insert')
    await expect(db.upsertAuditResult(P, PI1, U.aud, PG, 'compliant')).rejects.toBeTruthy()
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'))
    failNext('Audit_Result', 'update')
    await expect(db.upsertAuditResult(P, PI1, U.aud, PG, 'compliant')).rejects.toBeTruthy()
    failNext('Checklist', 'select')
    await expect(db.upsertAuditResult(P, PI1, U.aud, PG, 'compliant')).rejects.toBeTruthy()
    failNext('Checklist_Item', 'select')
    await expect(db.upsertAuditResult(P, PI1, U.aud, PG, 'compliant')).rejects.toBeTruthy()
    failNext('Audit_Result', 'select')
    await expect(db.fetchAuditResultStatus(P, PI1, U.aud)).rejects.toBeTruthy()
  })
})

describe('findings and evidence', () => {
  beforeEach(() => { tables.Audit_Result.push(answer(P, PI1, U.aud, 'non_compliant')) })

  it('saves findings and evidence on the auditor\'s own answer only', async () => {
    await db.saveAuditFindings(P, PI1, U.aud, 'Gap found')
    await db.saveEvidenceImages(P, PI1, U.aud, [{ url: 'u', name: 'n' }])
    expect(tables.Audit_Result[0]).toMatchObject({ findings: 'Gap found', evidenceImages: [{ url: 'u', name: 'n' }] })
    await expect(db.saveAuditFindings(P, PI1, U.aud2, 'x')).rejects.toBeInstanceOf(db.ResultNotFoundError)
    await expect(db.saveEvidenceImages(P, PI2, U.aud, [])).rejects.toBeInstanceOf(db.ResultNotFoundError)
  })

  it('refuses a locked audit and throws when the update fails', async () => {
    await expect(db.saveAuditFindings(LOCKED, LI1, U.aud, 'x')).rejects.toBeInstanceOf(db.EditLockedError)
    await expect(db.saveEvidenceImages(LOCKED, LI1, U.aud, [])).rejects.toBeInstanceOf(db.EditLockedError)
    failNext('Audit_Result', 'update')
    await expect(db.saveAuditFindings(P, PI1, U.aud, 'x')).rejects.toBeTruthy()
    failNext('Audit_Result', 'update')
    await expect(db.saveEvidenceImages(P, PI1, U.aud, [])).rejects.toBeTruthy()
  })

  it('fetchEvidenceForItems answers only answers with images, and [] for no items', async () => {
    tables.Audit_Result.push({ ...answer(P, PI2, U.aud, 'compliant'), evidenceImages: [{ url: 'a', name: 'b' }] }, { ...answer(P, PI1, U.aud2, 'compliant'), evidenceImages: null })
    expect(await db.fetchEvidenceForItems(P, [])).toEqual([])
    expect(await db.fetchEvidenceForItems(P, [PI1, PI2])).toEqual([{ itemId: PI2, userId: U.aud, images: [{ url: 'a', name: 'b' }] }])
    failNext('Audit_Result')
    await expect(db.fetchEvidenceForItems(P, [PI1])).rejects.toBeTruthy()
  })

  it('fetchAuditResults answers the project\'s answers and throws on failure', async () => {
    expect(await db.fetchAuditResults(P)).toHaveLength(1)
    failNext('Audit_Result')
    await expect(db.fetchAuditResults(P)).rejects.toBeTruthy()
  })
})

describe('updateChecklistItem and deleteChecklistItem', () => {
  it('changes only description, severity and category', async () => {
    await db.updateChecklistItem(PI1, { itemDescription: 'New text', severity: 'minor', category: 'Age 2', checklistId: 'x' } as any)
    expect(tables.Checklist_Item.find((i) => i.itemId === PI1)).toMatchObject({ itemDescription: 'New text', severity: 'minor', category: 'Age 2', checklistId: 'pcl' })
  })

  it('does nothing without a change, and edits a library item without a lock check', async () => {
    failNext('Checklist_Item', 'update')
    await db.updateChecklistItem(PI1, {})
    // The queued failure was not used by the no-op above, so the next update fails.
    await expect(db.updateChecklistItem(PI1, { severity: 'minor' })).rejects.toBeTruthy()
    await db.updateChecklistItem(GI1, { severity: 'minor' })
    expect(tables.Checklist_Item.find((i) => i.itemId === GI1)?.severity).toBe('minor')
  })

  it('refuses an item of a locked audit', async () => {
    await expect(db.updateChecklistItem(LI1, { severity: 'minor' })).rejects.toBeInstanceOf(db.EditLockedError)
    await expect(db.deleteChecklistItem(LI1)).rejects.toBeInstanceOf(db.EditLockedError)
    expect(tables.Checklist_Item.map((i) => i.itemId)).toContain(LI1)
  })

  it('deletes an item and its answers, and throws when a delete fails', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'))
    await db.deleteChecklistItem(PI1)
    expect(tables.Checklist_Item.map((i) => i.itemId)).not.toContain(PI1)
    expect(tables.Audit_Result).toEqual([])
    failNext('Audit_Result', 'delete')
    await expect(db.deleteChecklistItem(PI2)).rejects.toBeTruthy()
    failNext('Checklist_Item', 'delete')
    await expect(db.deleteChecklistItem(PI2)).rejects.toBeTruthy()
    failNext('Checklist', 'select')
    await expect(db.deleteChecklistItem(PI2)).rejects.toBeTruthy()
    failNext('Checklist_Item', 'select')
    await expect(db.deleteChecklistItem(PI2)).rejects.toBeTruthy()
  })

  it('deletes an item that has no checklist any more', async () => {
    tables.Checklist_Item.push({ itemId: id(70), checklistId: 'gone', category: 'x' })
    await db.deleteChecklistItem(id(70))
    expect(tables.Checklist_Item.map((i) => i.itemId)).not.toContain(id(70))
  })
})

describe('addProjectChecklistItem', () => {
  it('adds an item with empty optional fields, and throws without a project checklist', async () => {
    const itemId = await db.addProjectChecklistItem(P, PG, { category: 'Age', text: 'Custom', severity: 'major', helpText: 'h' })
    expect(tables.Checklist_Item.find((i) => i.itemId === itemId)).toMatchObject({ checklistId: 'pcl', reference: null, itemName: null, helpText: 'h' })
    await expect(db.addProjectChecklistItem(P, G, { category: 'Age', text: 'x', severity: 'major' })).rejects.toMatchObject({ code: 'PGRST116' })
    failNext('Checklist_Item', 'insert')
    await expect(db.addProjectChecklistItem(P, PG, { category: 'Age', text: 'x', severity: 'major' })).rejects.toBeTruthy()
  })
})
