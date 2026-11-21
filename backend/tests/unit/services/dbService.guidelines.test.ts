import { beforeEach, describe, expect, it, vi } from 'vitest'
import { failNext, resetTables, tables } from '../../helpers/fakeSupabase.js'
import { answer, coreWorld, G, G2, GI1, GI2, id, LOCKED, OTHER, P, PG, PI1, PI2, U } from '../../fixtures/coreWorld.js'

vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

const db = await import('../../../src/services/dbService.js')

beforeEach(() => { resetTables(coreWorld()) })

const clonesOf = (projectId: string) => tables.Guideline.filter((g) => g.projectId === projectId)
const itemsOf = (checklistId: string) => tables.Checklist_Item.filter((i) => i.checklistId === checklistId)

describe('syncProjectGuidelines', () => {
  it('clones a new library guideline into the project with a checklist copied from the library', async () => {
    tables.Checklist_Item.push({ itemId: id(33), checklistId: 'gcl2', category: 'Privacy', itemDescription: 'Profiles are private', severity: 'major', reference: '3' })
    await db.syncProjectGuidelines(P, [G, G2])

    const clones = clonesOf(P)
    expect(clones.map((g) => g.originalGuidelineId).sort()).toEqual([G, G2].sort())
    const newClone = clones.find((g) => g.originalGuidelineId === G2)!
    expect(newClone).toMatchObject({ guidelineName: 'Design Code', shortName: 'DC', projectId: P, userId: U.admin })
    const checklist = tables.Checklist.find((c) => c.guidelineId === newClone.guidelineId)!
    expect(checklist).toMatchObject({ projectId: P, checklistSource: 'generator' })
    expect(itemsOf(checklist.checklistId)).toEqual([expect.objectContaining({ originalItemId: id(33), itemDescription: 'Profiles are private', category: 'Privacy' })])
    // The guideline that was already attached keeps its checklist and answers.
    expect(tables.Checklist.filter((c) => c.guidelineId === PG)).toHaveLength(1)
  })

  it('removes an unanswered guideline that is no longer selected', async () => {
    await db.syncProjectGuidelines(P, [])
    expect(clonesOf(P)).toEqual([])
  })

  it('refuses to remove a guideline that has answers', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'))
    await expect(db.syncProjectGuidelines(P, [])).rejects.toBeInstanceOf(db.GuidelineHasAnswersError)
    expect(clonesOf(P)).toHaveLength(1)
  })

  it('refuses a locked audit and an unknown library guideline', async () => {
    await expect(db.syncProjectGuidelines(LOCKED, [])).rejects.toBeInstanceOf(db.EditLockedError)
    await expect(db.syncProjectGuidelines(P, [G, id(999)])).rejects.toMatchObject({ code: 'PGRST116' })
  })

  it('throws when a step fails', async () => {
    failNext('Guideline', 'select')
    await expect(db.syncProjectGuidelines(P, [G])).rejects.toBeTruthy()
    failNext('Audit_Result', 'select')
    await expect(db.syncProjectGuidelines(P, [])).rejects.toBeTruthy()
    failNext('Guideline', 'delete')
    await expect(db.syncProjectGuidelines(P, [])).rejects.toBeTruthy()
    failNext('Guideline', 'insert')
    await expect(db.syncProjectGuidelines(P, [G, G2])).rejects.toBeTruthy()
  })
})

describe('initializeProjectChecklists', () => {
  it('does nothing for a project without guidelines, or a guideline that is not a library copy', async () => {
    await db.initializeProjectChecklists(OTHER)
    tables.Guideline.push({ guidelineId: 'own', projectId: OTHER, originalGuidelineId: null })
    await db.initializeProjectChecklists(OTHER)
    expect(tables.Checklist.filter((c) => c.projectId === OTHER)).toEqual([])
  })

  it('skips a library guideline that has no checklist', async () => {
    tables.Guideline.push({ guidelineId: 'copy', projectId: OTHER, originalGuidelineId: 'gone' })
    await db.initializeProjectChecklists(OTHER)
    expect(tables.Checklist.filter((c) => c.projectId === OTHER)).toEqual([])
  })

  it('treats a checklist created at the same moment as done (23505)', async () => {
    tables.Guideline.push({ guidelineId: 'copy', projectId: OTHER, originalGuidelineId: G })
    failNext('Checklist', 'insert', { code: '23505', message: 'duplicate' })
    await db.initializeProjectChecklists(OTHER)
    expect(tables.Checklist.filter((c) => c.projectId === OTHER)).toEqual([])
  })

  it('throws other insert errors', async () => {
    tables.Guideline.push({ guidelineId: 'copy', projectId: OTHER, originalGuidelineId: G })
    failNext('Checklist', 'insert', { code: '42501', message: 'denied' })
    await expect(db.initializeProjectChecklists(OTHER)).rejects.toMatchObject({ code: '42501' })
    failNext('Checklist_Item', 'insert')
    await expect(db.initializeProjectChecklists(OTHER)).rejects.toBeTruthy()
  })
})

describe('fetchProjectChecklistItems', () => {
  it('answers the active items in clause order, building a missing checklist first', async () => {
    tables.Guideline.push({ guidelineId: 'copy', projectId: OTHER, originalGuidelineId: G })
    const items = await db.fetchProjectChecklistItems(OTHER)
    expect(items.map((i) => [i.reference, i.guidelineId])).toEqual([['Clause 2', 'copy'], ['Clause 10', 'copy']])
    expect(items.every((i) => i.itemId !== GI1 && i.itemId !== GI2)).toBe(true)
  })

  it('answers [] for a project without checklists, and throws when a read fails', async () => {
    expect(await db.fetchProjectChecklistItems(OTHER)).toEqual([])
    failNext('Checklist_Item', 'select')
    await expect(db.fetchProjectChecklistItems(P)).rejects.toBeTruthy()
  })
})

describe('toggleProjectChecklistCategory', () => {
  it('hides a category and brings the same items back', async () => {
    await db.toggleProjectChecklistCategory(P, PG, 'Age', false)
    expect(tables.Checklist_Item.find((i) => i.itemId === PI1)?.category).toBe('__deactivated__Age')
    await db.toggleProjectChecklistCategory(P, PG, 'Age', true)
    expect(tables.Checklist_Item.find((i) => i.itemId === PI1)?.category).toBe('Age')
  })

  it('does nothing when enabling a category that is already on', async () => {
    const before = tables.Checklist_Item.length
    await db.toggleProjectChecklistCategory(P, PG, 'Age', true)
    expect(tables.Checklist_Item).toHaveLength(before)
  })

  it('copies a category back from the library when its items were deleted', async () => {
    tables.Checklist_Item = tables.Checklist_Item.filter((i) => i.itemId !== PI2)
    await db.toggleProjectChecklistCategory(P, PG, 'Privacy', true)
    const copied = itemsOf('pcl').filter((i) => i.category === 'Privacy')
    expect(copied).toEqual([expect.objectContaining({ originalItemId: GI2, itemDescription: 'Child accounts are private by default' })])
  })

  it('uses the guideline itself as the template when it is not a library copy', async () => {
    tables.Checklist.push({ checklistId: 'libp', guidelineId: G, projectId: OTHER })
    await db.toggleProjectChecklistCategory(OTHER, G, 'Age', true)
    expect(itemsOf('libp')).toEqual([expect.objectContaining({ originalItemId: GI1 })])
  })

  it('refuses a locked audit and throws on a failed update', async () => {
    await expect(db.toggleProjectChecklistCategory(LOCKED, id(13), 'Age', false)).rejects.toBeInstanceOf(db.EditLockedError)
    failNext('Checklist_Item', 'update')
    await expect(db.toggleProjectChecklistCategory(P, PG, 'Age', false)).rejects.toBeTruthy()
  })
})

describe('createGuideline', () => {
  const guideline = { guidelineId: 'NEW', guidelineName: 'New', shortName: 'N', version: '1', description: '', source: '', categories: ['A'], lastUpdated: '2026-01-01', userId: U.admin }
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, category: 'A', text: `Check ${i}`, severity: 'minor' as const }))

  it('stores a large guideline in chunks of 50 items', async () => {
    await db.createGuideline({ guideline, items: items(120) })
    const checklist = tables.Checklist.find((c) => c.guidelineId === 'NEW')!
    expect(itemsOf(checklist.checklistId)).toHaveLength(120)
    expect(itemsOf(checklist.checklistId)[0]).toMatchObject({ itemDescription: 'Check 0', reference: null, helpText: null })
  })

  it('credits the guideline to the first user when the given one does not exist', async () => {
    await db.createGuideline({ guideline: { ...guideline, userId: id(999) }, items: [] })
    expect(tables.Guideline.find((g) => g.guidelineId === 'NEW')?.userId).toBe(U.admin)
    await db.createGuideline({ guideline: { ...guideline, guidelineId: 'NEW2', userId: '' }, items: [] })
    expect(tables.Guideline.find((g) => g.guidelineId === 'NEW2')?.userId).toBe(U.admin)
  })

  it('removes the guideline again when its items cannot be saved', async () => {
    failNext('Checklist_Item', 'insert', { message: 'too big' })
    await expect(db.createGuideline({ guideline, items: items(3) })).rejects.toMatchObject({ message: 'too big' })
    expect(tables.Guideline.find((g) => g.guidelineId === 'NEW')).toBeUndefined()
  })

  it('throws when the guideline row or the checklist cannot be saved', async () => {
    failNext('Guideline', 'insert')
    await expect(db.createGuideline({ guideline, items: [] })).rejects.toBeTruthy()
    failNext('Checklist', 'insert')
    await expect(db.createGuideline({ guideline, items: [] })).rejects.toBeTruthy()
    expect(tables.Guideline.find((g) => g.guidelineId === 'NEW')).toBeUndefined()
  })
})

describe('fetchGuidelines and fetchGuidelineItems', () => {
  it('lists only library guidelines', async () => {
    const list = await db.fetchGuidelines()
    expect(list.map((g) => g.guidelineId).sort()).toEqual([G, G2].sort())
  })

  it('answers the library items of a guideline, and [] when it has no library checklist', async () => {
    const items = await db.fetchGuidelineItems(G)
    expect(items.map((i) => i.itemId)).toEqual([GI1, GI2])
    expect(items[0].guidelineId).toBe(G)
    expect(await db.fetchGuidelineItems(PG)).toEqual([])
  })

  it('throws when a read fails', async () => {
    failNext('Guideline')
    await expect(db.fetchGuidelines()).rejects.toBeTruthy()
    failNext('Checklist', 'select', { code: '42501', message: 'denied' })
    await expect(db.fetchGuidelineItems(G)).rejects.toMatchObject({ code: '42501' })
    failNext('Checklist_Item', 'select')
    await expect(db.fetchGuidelineItems(G)).rejects.toBeTruthy()
  })
})
