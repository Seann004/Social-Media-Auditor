import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables, tables } from '../test/fakeSupabase.js'

vi.mock('../config/supabase.js', async () => {
  const fake = await import('../test/fakeSupabase.js')
  return { supabase: fake.supabase }
})

const { deleteGuideline } = await import('./dbService.js')

function seed(extra: Record<string, any[]> = {}) {
  resetTables({
    Guideline: [
      { guidelineId: 'G1', guidelineName: 'Library one', projectId: null },
      { guidelineId: 'G2', guidelineName: 'Library two', projectId: null },
    ],
    Checklist: [
      { checklistId: 'c1', guidelineId: 'G1', projectId: null },
      { checklistId: 'c2', guidelineId: 'G2', projectId: null },
    ],
    Checklist_Item: [
      { itemId: 'i1', checklistId: 'c1' },
      { itemId: 'i2', checklistId: 'c1' },
      { itemId: 'i3', checklistId: 'c2' },
    ],
    Audit_Result: [],
    ...extra,
  })
}

beforeEach(() => { seed() })

describe('deleteGuideline', () => {
  it('removes the checklist, its items and the guideline row', async () => {
    await deleteGuideline('G1')
    expect(tables.Checklist.map((c) => c.checklistId)).toEqual(['c2'])
    expect(tables.Checklist_Item.map((i) => i.itemId)).toEqual(['i3'])
    expect(tables.Guideline.map((g) => g.guidelineId)).toEqual(['G2'])
  })

  it('leaves other guidelines alone', async () => {
    await deleteGuideline('G1')
    expect(tables.Guideline.find((g) => g.guidelineId === 'G2')).toBeTruthy()
    expect(tables.Checklist_Item.find((i) => i.itemId === 'i3')).toBeTruthy()
  })

  it('keeps the guideline row while a project checklist still points at it', async () => {
    tables.Checklist.push({ checklistId: 'pc1', guidelineId: 'G1', projectId: 'P1' })
    await deleteGuideline('G1')
    expect(tables.Checklist.map((c) => c.checklistId).sort()).toEqual(['c2', 'pc1'])
    expect(tables.Guideline.map((g) => g.guidelineId).sort()).toEqual(['G1', 'G2'])
  })

  it('still removes the row of a guideline whose checklist is already gone', async () => {
    tables.Checklist = tables.Checklist.filter((c) => c.checklistId !== 'c1')
    await deleteGuideline('G1')
    expect(tables.Guideline.map((g) => g.guidelineId)).toEqual(['G2'])
  })

  it('does nothing for a guideline that does not exist', async () => {
    await deleteGuideline('nope')
    expect(tables.Guideline).toHaveLength(2)
    expect(tables.Checklist).toHaveLength(2)
  })

  it('removes the answers given on the guideline\'s library items', async () => {
    tables.Audit_Result.push({ resultId: 'r1', itemId: 'i1' }, { resultId: 'r2', itemId: 'i3' })
    await deleteGuideline('G1')
    expect(tables.Audit_Result.map((r) => r.resultId)).toEqual(['r2'])
  })
})
