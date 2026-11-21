import { beforeEach, describe, expect, it, vi } from 'vitest'
import { failNext, resetTables, tables } from '../../helpers/fakeSupabase.js'
import { answer, coreWorld, G2, LOCKED, OTHER, P, PG, PI1, PI2, U } from '../../fixtures/coreWorld.js'

vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

const db = await import('../../../src/services/dbService.js')

beforeEach(() => { resetTables(coreWorld()) })

describe('compareReferences', () => {
  it('orders clause numbers numerically, and missing references last', () => {
    const refs = ['Clause 10', null, 'Clause 2', 'Clause 2.1', 'Annex A', 'Clause 1']
    expect([...refs].sort(db.compareReferences)).toEqual(['Annex A', 'Clause 1', 'Clause 2', 'Clause 2.1', 'Clause 10', null])
    expect(db.compareReferences(null, null)).toBe(0)
    expect(db.compareReferences('x', null)).toBeLessThan(0)
    expect(db.compareReferences('Clause 3', 'Clause 3')).toBe(0)
  })
})

describe('reconcileEffectiveStatus', () => {
  it('takes a resolution first, an agreed answer next, and needs_review when auditors disagree', () => {
    expect(db.reconcileEffectiveStatus(['compliant', 'non_compliant'], 'partially')).toBe('partially')
    expect(db.reconcileEffectiveStatus(['compliant', 'compliant'])).toBe('compliant')
    expect(db.reconcileEffectiveStatus(['compliant', 'non_compliant'])).toBe('needs_review')
  })
})

describe('fetchProjectComplianceSummary', () => {
  it('answers {} for no projects', async () => {
    expect(await db.fetchProjectComplianceSummary([])).toEqual({})
  })

  it('weights partial answers by half and leaves not-applicable items out of the percentage', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'partially'), answer(P, PI2, U.aud, 'not_applicable'))
    expect(await db.fetchProjectComplianceSummary([P])).toEqual({ [P]: { percentage: 50, answered: 2, total: 2 } })
  })

  it('does not count an item the auditors disagree on until it is resolved', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'), answer(P, PI1, U.aud2, 'non_compliant'), answer(P, PI2, U.aud, 'compliant'))
    expect((await db.fetchProjectComplianceSummary([P]))[P]).toEqual({ percentage: 100, answered: 1, total: 2 })

    tables.Checklist_Resolution.push({ resolutionId: 'x', projectId: P, itemId: PI1, resolvedStatus: 'non_compliant' })
    expect((await db.fetchProjectComplianceSummary([P]))[P]).toEqual({ percentage: 50, answered: 2, total: 2 })
  })

  it('ignores deactivated items and answers to items outside the checklist', async () => {
    tables.Checklist_Item.find((i) => i.itemId === PI2)!.category = '__deactivated__Privacy'
    tables.Audit_Result.push(answer(P, PI2, U.aud, 'compliant'), answer(P, 'stray-item', U.aud, 'compliant'))
    expect((await db.fetchProjectComplianceSummary([P, OTHER]))).toEqual({
      [P]: { percentage: 0, answered: 0, total: 1 },
      [OTHER]: { percentage: 0, answered: 0, total: 0 },
    })
  })

  it('throws when a query fails', async () => {
    for (const table of ['Checklist', 'Checklist_Item', 'Audit_Result', 'Checklist_Resolution']) {
      failNext(table)
      await expect(db.fetchProjectComplianceSummary([P])).rejects.toMatchObject({ message: 'database unavailable' })
    }
  })
})

describe('fetchComplianceScores', () => {
  it('answers [] for a project without guidelines', async () => {
    expect(await db.fetchComplianceScores(OTHER)).toEqual([])
  })

  it('scores each guideline of the project from its own items', async () => {
    // A second guideline with no checklist yet scores zero out of zero.
    tables.Guideline.push({ guidelineId: 'pg2', guidelineName: null, shortName: null, projectId: P, originalGuidelineId: G2 })
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'), answer(P, PI2, U.aud, 'non_compliant'), answer(P, PI2, U.aud2, 'compliant'))
    tables.Checklist_Resolution.push({ resolutionId: 'x', projectId: P, itemId: PI2, resolvedStatus: 'not_applicable' })

    const scores = await db.fetchComplianceScores(P)
    expect(scores).toHaveLength(2)
    expect(scores[0]).toMatchObject({ guidelineId: PG, guidelineName: 'Online Safety Code', totalItems: 2, answeredItems: 2, compliantItems: 1, notApplicableItems: 1, scorePercentage: 100 })
    expect(scores[1]).toMatchObject({ guidelineId: 'pg2', guidelineName: 'Guideline', shortName: 'Guideline', totalItems: 0, answeredItems: 0, scorePercentage: 0 })
    expect(Number.isNaN(Date.parse(scores[0].timeCalculated))).toBe(false)
  })

  it('throws when a query fails', async () => {
    for (const table of ['Guideline', 'Checklist', 'Checklist_Item', 'Audit_Result', 'Checklist_Resolution']) {
      failNext(table)
      await expect(db.fetchComplianceScores(P)).rejects.toBeTruthy()
    }
  })
})

describe('computeInterRaterReliability', () => {
  it('answers null without two auditors on the same item', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'), answer(P, PI2, U.aud2, 'compliant'), answer(P, PI1, U.aud2, 'not_applicable'))
    expect(await db.computeInterRaterReliability(P)).toEqual({ kappa: null, sharedItems: 0, raterPair: null })
  })

  it('answers 1 for perfect agreement and -1 for opposite answers', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'), answer(P, PI1, U.aud2, 'compliant'))
    expect(await db.computeInterRaterReliability(P)).toEqual({ kappa: 1, sharedItems: 1, raterPair: [U.aud, U.aud2] })

    resetTables(coreWorld())
    tables.Audit_Result.push(
      answer(P, PI1, U.aud, 'compliant'), answer(P, PI1, U.aud2, 'non_compliant'),
      answer(P, PI2, U.aud, 'non_compliant'), answer(P, PI2, U.aud2, 'compliant'),
    )
    expect((await db.computeInterRaterReliability(P)).kappa).toBe(-1)
  })

  it('uses the pair of auditors that share the most items', async () => {
    tables.Audit_Result.push(
      answer(P, PI1, U.aud, 'compliant'), answer(P, PI1, U.aud2, 'partially'), answer(P, PI1, U.head, 'compliant'),
      answer(P, PI2, U.aud, 'non_compliant'), answer(P, PI2, U.aud2, 'non_compliant'),
    )
    const r = await db.computeInterRaterReliability(P)
    expect(r.raterPair).toEqual([U.aud, U.aud2])
    expect(r.sharedItems).toBe(2)
    expect(r.kappa).toBeGreaterThan(0)
    expect(r.kappa).toBeLessThan(1)
  })

  it('throws when the query fails', async () => {
    failNext('Audit_Result')
    await expect(db.computeInterRaterReliability(LOCKED)).rejects.toBeTruthy()
  })
})
