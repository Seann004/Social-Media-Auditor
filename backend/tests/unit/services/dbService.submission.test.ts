import { beforeEach, describe, expect, it, vi } from 'vitest'
import { failNext, resetTables, tables } from '../../helpers/fakeSupabase.js'
import { answer, coreWorld, id, LG, LI1, LOCKED, P, PI1, PI2, U } from '../../fixtures/coreWorld.js'

vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

const db = await import('../../../src/services/dbService.js')

const project = (projectId: string) => tables.Audit_Project.find((p) => p.projectId === projectId)!
const answerAll = () => tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'), answer(P, PI2, U.aud, 'non_compliant'))

beforeEach(() => { resetTables(coreWorld()) })

describe('assertProjectEditable', () => {
  it('allows not submitted and rejected audits, and locks pending and approved ones', async () => {
    await expect(db.assertProjectEditable(P)).resolves.toBeUndefined()
    project(P).submissionStatus = 'rejected'
    await expect(db.assertProjectEditable(P)).resolves.toBeUndefined()
    await expect(db.assertProjectEditable(LOCKED)).rejects.toBeInstanceOf(db.EditLockedError)
    project(LOCKED).submissionStatus = 'approved'
    await expect(db.assertProjectEditable(LOCKED)).rejects.toBeInstanceOf(db.EditLockedError)
  })

  it('throws the database error for an unknown project', async () => {
    await expect(db.assertProjectEditable(id(999))).rejects.toMatchObject({ code: 'PGRST116' })
  })
})

describe('submitForReview', () => {
  it('refuses an audit with unanswered items', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'))
    await expect(db.submitForReview(P)).rejects.toBeInstanceOf(db.IncompleteCoverageError)
    expect(project(P).submissionStatus).toBe('not_submitted')
  })

  it('says the audit cannot be submitted, since this error is shown on submit as well as on approval', async () => {
    await expect(db.submitForReview(P)).rejects.toThrow(/cannot be submitted or approved until every checklist item/)
  })

  it('refuses an audit with no checklist items at all', async () => {
    tables.Checklist_Item = tables.Checklist_Item.filter((i) => i.checklistId !== 'pcl')
    await expect(db.submitForReview(P)).rejects.toBeInstanceOf(db.IncompleteCoverageError)
  })

  it('refuses while auditors disagree on an item, and accepts once it is resolved', async () => {
    answerAll()
    tables.Audit_Result.push(answer(P, PI1, U.aud2, 'non_compliant'))
    await expect(db.submitForReview(P)).rejects.toBeInstanceOf(db.IncompleteCoverageError)
    tables.Checklist_Resolution.push({ resolutionId: 'x', projectId: P, itemId: PI1, resolvedStatus: 'compliant' })
    await db.submitForReview(P)
    expect(project(P).submissionStatus).toBe('pending_review')
  })

  it('submits a complete audit, records its report once, and lets a rejected audit be submitted again', async () => {
    answerAll()
    await db.submitForReview(P)
    expect(project(P)).toMatchObject({ submissionStatus: 'pending_review', projectStatus: 'under_review' })
    expect(tables.Audit_Report).toEqual([expect.objectContaining({ projectId: P, userId: U.head })])

    project(P).submissionStatus = 'rejected'
    await db.submitForReview(P)
    expect(tables.Audit_Report).toHaveLength(1)
  })

  it('refuses an audit that is pending review or approved', async () => {
    await expect(db.submitForReview(LOCKED)).rejects.toBeInstanceOf(db.AlreadySubmittedError)
    project(LOCKED).submissionStatus = 'approved'
    await expect(db.submitForReview(LOCKED)).rejects.toBeInstanceOf(db.AlreadySubmittedError)
  })

  it('throws when the status update or the report fails', async () => {
    answerAll()
    failNext('Audit_Project', 'update')
    await expect(db.submitForReview(P)).rejects.toMatchObject({ message: 'database unavailable' })
    failNext('Audit_Report', 'upsert')
    await expect(db.submitForReview(P)).rejects.toMatchObject({ message: 'database unavailable' })
  })
})

describe('reviewSubmission', () => {
  it('approves a complete audit', async () => {
    tables.Audit_Result.push(answer(LOCKED, LI1, U.aud, 'compliant', LG))
    await db.reviewSubmission(LOCKED, true, '')
    expect(project(LOCKED)).toMatchObject({ submissionStatus: 'approved', projectStatus: 'completed', submissionRemarks: null })
    expect(tables.Audit_Report.map((r) => r.projectId)).toEqual([LOCKED])
  })

  it('refuses to approve an incomplete audit but sends it back with remarks', async () => {
    await expect(db.reviewSubmission(LOCKED, true, '')).rejects.toBeInstanceOf(db.IncompleteCoverageError)
    expect(project(LOCKED).submissionStatus).toBe('pending_review')
    await db.reviewSubmission(LOCKED, false, 'More evidence please')
    expect(project(LOCKED)).toMatchObject({ submissionStatus: 'rejected', projectStatus: 'in_progress', submissionRemarks: 'More evidence please' })
  })

  it('refuses an audit that is not awaiting review', async () => {
    await expect(db.reviewSubmission(P, false, '')).rejects.toThrow('This audit is not awaiting review.')
  })

  it('throws when the project cannot be read or the report cannot be written', async () => {
    failNext('Audit_Project', 'select')
    await expect(db.reviewSubmission(LOCKED, false, '')).rejects.toBeTruthy()
    failNext('Audit_Report', 'upsert')
    await expect(db.reviewSubmission(LOCKED, false, '')).rejects.toMatchObject({ message: 'database unavailable' })
  })
})

describe('resolveDisagreement', () => {
  it('refuses a status that is not final', async () => {
    await expect(db.resolveDisagreement(P, PI1, U.head, 'needs_review')).rejects.toThrow('definitive')
    await expect(db.resolveDisagreement(P, PI1, U.head, 'not_started')).rejects.toThrow('definitive')
  })

  it('records one resolution per item and updates it', async () => {
    await db.resolveDisagreement(P, PI1, U.head, 'compliant', 'agreed in meeting')
    await db.resolveDisagreement(P, PI1, U.head, 'partially')
    expect(tables.Checklist_Resolution).toHaveLength(1)
    expect(tables.Checklist_Resolution[0]).toMatchObject({ resolvedStatus: 'partially', notes: null })
    expect(await db.fetchResolutions(P)).toEqual([expect.objectContaining({ itemId: PI1, resolvedStatus: 'partially' })])
  })

  it('refuses an item of another project and an approved audit', async () => {
    await expect(db.resolveDisagreement(P, LI1, U.head, 'compliant')).rejects.toBeInstanceOf(db.ResultNotFoundError)
    await expect(db.resolveDisagreement(P, id(999), U.head, 'compliant')).rejects.toBeInstanceOf(db.ResultNotFoundError)
    project(P).submissionStatus = 'approved'
    await expect(db.resolveDisagreement(P, PI1, U.head, 'compliant')).rejects.toBeInstanceOf(db.EditLockedError)
  })

  it('throws when the resolution cannot be saved', async () => {
    failNext('Checklist_Resolution', 'insert')
    await expect(db.resolveDisagreement(P, PI1, U.head, 'compliant')).rejects.toBeTruthy()
    failNext('Checklist_Resolution', 'select')
    await expect(db.resolveDisagreement(P, PI1, U.head, 'compliant')).rejects.toBeTruthy()
    tables.Checklist_Resolution.push({ resolutionId: 'x', projectId: P, itemId: PI1, resolvedStatus: 'compliant' })
    failNext('Checklist_Resolution', 'update')
    await expect(db.resolveDisagreement(P, PI1, U.head, 'compliant')).rejects.toBeTruthy()
    failNext('Checklist_Resolution', 'select')
    await expect(db.fetchResolutions(P)).rejects.toBeTruthy()
  })
})
