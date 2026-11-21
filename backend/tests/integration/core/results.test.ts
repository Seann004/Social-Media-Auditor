import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables, tables } from '../../helpers/fakeSupabase.js'
import { answer, coreWorld, G2, GI1, id, LG, LI1, LOCKED, OTHER, P, PG, PI1, PI2, U } from '../../fixtures/coreWorld.js'
import { loadCoreServer, quietConsole } from '../../helpers/coreServer.js'

vi.mock('dotenv/config', () => ({}))
vi.mock('dotenv', () => ({ default: { config: () => ({}) }, config: () => ({}) }))
vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

const { app, bearer } = await loadCoreServer()

const as = {
  admin: bearer(U.admin, 'admin'),
  head: bearer(U.head, 'head_auditor'),
  headOther: bearer(U.headOther, 'head_auditor'),
  aud: bearer(U.aud, 'auditor'),
  aud2: bearer(U.aud2, 'auditor'),
  outsider: bearer(U.outsider, 'auditor'),
}

const project = (projectId: string) => tables.Audit_Project.find((p) => p.projectId === projectId)!

beforeEach(() => {
  resetTables(coreWorld())
  quietConsole()
})
afterEach(() => vi.restoreAllMocks())

describe('POST /api/projects/:id/results', () => {
  it('saves an answer under the guideline the item really belongs to, then updates it', async () => {
    const first = await request(app).post(`/api/projects/${P}/results`).set('Authorization', as.aud)
      .send({ itemId: PI1, guidelineId: G2, result: 'compliant', notes: 'checked' })
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ success: true, filledIn: [] })
    expect(tables.Audit_Result).toHaveLength(1)
    expect(tables.Audit_Result[0]).toMatchObject({ projectId: P, itemId: PI1, userId: U.aud, guidelineId: PG, result: 'compliant', notes: 'checked' })

    const second = await request(app).post(`/api/projects/${P}/results`).set('Authorization', as.aud)
      .send({ itemId: PI1, guidelineId: PG, result: 'needs_review' })
    expect(second.status).toBe(200)
    expect(tables.Audit_Result).toHaveLength(1)
    expect(tables.Audit_Result[0]).toMatchObject({ result: 'needs_review', notes: null })
  })

  it('answers 400 without an item, a guideline or a valid result', async () => {
    for (const body of [{ guidelineId: PG, result: 'compliant' }, { itemId: PI1, result: 'compliant' }, { itemId: PI1, guidelineId: PG, result: 'great' }]) {
      expect((await request(app).post(`/api/projects/${P}/results`).set('Authorization', as.aud).send(body)).status).toBe(400)
    }
  })

  it('answers 404 for an item of another project or the library', async () => {
    const res = await request(app).post(`/api/projects/${P}/results`).set('Authorization', as.aud).send({ itemId: LI1, guidelineId: PG, result: 'compliant' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('This checklist item does not belong to this project.')
    expect((await request(app).post(`/api/projects/${P}/results`).set('Authorization', as.aud).send({ itemId: GI1, guidelineId: PG, result: 'compliant' })).status).toBe(404)
    expect(tables.Audit_Result).toHaveLength(0)
  })

  it('answers 403 while the audit is locked and to someone outside the project', async () => {
    const locked = await request(app).post(`/api/projects/${LOCKED}/results`).set('Authorization', as.aud).send({ itemId: LI1, guidelineId: LG, result: 'compliant' })
    expect(locked.status).toBe(403)
    expect(locked.body.error).toBe('This audit is locked because it is under review or already approved.')
    expect((await request(app).post(`/api/projects/${P}/results`).set('Authorization', as.outsider).send({ itemId: PI1, guidelineId: PG, result: 'compliant' })).status).toBe(403)
  })
})

describe('PATCH findings and evidence', () => {
  beforeEach(() => { tables.Audit_Result.push(answer(P, PI1, U.aud, 'non_compliant')) })

  it('saves findings on the caller\'s own answer', async () => {
    const res = await request(app).patch(`/api/projects/${P}/results/${PI1}/findings`).set('Authorization', as.aud).send({ findings: 'No age gate' })
    expect(res.status).toBe(200)
    expect(tables.Audit_Result[0].findings).toBe('No age gate')
    await request(app).patch(`/api/projects/${P}/results/${PI1}/findings`).set('Authorization', as.aud).send({})
    expect(tables.Audit_Result[0].findings).toBeNull()
  })

  it('answers 404 before the item is answered, 400 for non-string findings and 403 when locked', async () => {
    const before = await request(app).patch(`/api/projects/${P}/results/${PI2}/findings`).set('Authorization', as.aud).send({ findings: 'x' })
    expect(before.status).toBe(404)
    expect(before.body.error).toMatch(/Answer this checklist item/)
    // Another auditor's answer is not theirs to change.
    expect((await request(app).patch(`/api/projects/${P}/results/${PI1}/findings`).set('Authorization', as.aud2).send({ findings: 'x' })).status).toBe(404)
    expect((await request(app).patch(`/api/projects/${P}/results/${PI1}/findings`).set('Authorization', as.aud).send({ findings: 5 })).status).toBe(400)
    expect((await request(app).patch(`/api/projects/${LOCKED}/results/${LI1}/findings`).set('Authorization', as.aud).send({ findings: 'x' })).status).toBe(403)
  })

  it('saves evidence images and lists them per item', async () => {
    const images = [{ url: 'https://img.example/a.png', name: 'a.png' }]
    const res = await request(app).patch(`/api/projects/${P}/results/${PI1}/evidence`).set('Authorization', as.aud).send({ images })
    expect(res.status).toBe(200)
    expect(tables.Audit_Result[0].evidenceImages).toEqual(images)

    const list = await request(app).get(`/api/projects/${P}/evidence?itemIds=${PI1},${PI2},`).set('Authorization', as.aud2)
    expect(list.status).toBe(200)
    expect(list.body).toEqual([{ itemId: PI1, userId: U.aud, images }])
  })

  it('clears evidence with no images, and answers 400 for malformed images and 404 without an answer', async () => {
    tables.Audit_Result[0].evidenceImages = [{ url: 'u', name: 'n' }]
    await request(app).patch(`/api/projects/${P}/results/${PI1}/evidence`).set('Authorization', as.aud).send({})
    expect(tables.Audit_Result[0].evidenceImages).toEqual([])
    expect((await request(app).patch(`/api/projects/${P}/results/${PI1}/evidence`).set('Authorization', as.aud).send({ images: [{ url: 1 }] })).status).toBe(400)
    expect((await request(app).patch(`/api/projects/${P}/results/${PI1}/evidence`).set('Authorization', as.aud).send({ images: 'x' })).status).toBe(400)
    expect((await request(app).patch(`/api/projects/${P}/results/${PI2}/evidence`).set('Authorization', as.aud).send({ images: [] })).status).toBe(404)
  })

  it('GET evidence answers 400 without itemIds', async () => {
    expect((await request(app).get(`/api/projects/${P}/evidence`).set('Authorization', as.aud)).status).toBe(400)
  })
})

describe('reading results', () => {
  it('GET results lists every auditor\'s answers, and refuses an outsider', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'), answer(P, PI1, U.aud2, 'partially'), answer(OTHER, PI1, U.headOther, 'compliant'))
    const res = await request(app).get(`/api/projects/${P}/results`).set('Authorization', as.head)
    expect(res.status).toBe(200)
    expect(res.body.map((r: any) => r.userId).sort()).toEqual([U.aud, U.aud2].sort())
    expect((await request(app).get(`/api/projects/${P}/results`).set('Authorization', as.outsider)).status).toBe(403)
  })

  it('GET reliability answers weighted kappa for the pair that shares most items', async () => {
    tables.Audit_Result.push(
      answer(P, PI1, U.aud, 'compliant'), answer(P, PI1, U.aud2, 'compliant'),
      answer(P, PI2, U.aud, 'non_compliant'), answer(P, PI2, U.aud2, 'non_compliant'),
    )
    const res = await request(app).get(`/api/projects/${P}/reliability`).set('Authorization', as.head)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ kappa: 1, sharedItems: 2, raterPair: [U.aud, U.aud2].sort() })
  })
})

describe('resolutions', () => {
  it('a head auditor resolves a disagreement, then changes the resolution', async () => {
    const first = await request(app).post(`/api/projects/${P}/results/${PI1}/resolve`).set('Authorization', as.head).send({ status: 'partially', notes: 'split' })
    expect(first.status).toBe(200)
    await request(app).post(`/api/projects/${P}/results/${PI1}/resolve`).set('Authorization', as.head).send({ status: 'compliant' })
    expect(tables.Checklist_Resolution).toHaveLength(1)
    expect(tables.Checklist_Resolution[0]).toMatchObject({ projectId: P, itemId: PI1, resolvedBy: U.head, resolvedStatus: 'compliant', notes: null })

    const list = await request(app).get(`/api/projects/${P}/resolutions`).set('Authorization', as.aud)
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)
  })

  it('answers 400 for a non-final status, 403 to an auditor, 404 for an item outside the project', async () => {
    expect((await request(app).post(`/api/projects/${P}/results/${PI1}/resolve`).set('Authorization', as.head).send({ status: 'needs_review' })).status).toBe(400)
    expect((await request(app).post(`/api/projects/${P}/results/${PI1}/resolve`).set('Authorization', as.aud).send({ status: 'compliant' })).status).toBe(403)
    expect((await request(app).post(`/api/projects/${P}/results/${LI1}/resolve`).set('Authorization', as.head).send({ status: 'compliant' })).status).toBe(404)
  })

  it('still resolves while under review, and answers 403 once approved', async () => {
    expect((await request(app).post(`/api/projects/${LOCKED}/results/${LI1}/resolve`).set('Authorization', as.head).send({ status: 'compliant' })).status).toBe(200)
    project(LOCKED).submissionStatus = 'approved'
    const res = await request(app).post(`/api/projects/${LOCKED}/results/${LI1}/resolve`).set('Authorization', as.head).send({ status: 'compliant' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('This audit has been approved and can no longer be changed.')
  })
})

describe('POST /api/projects/:id/submit', () => {
  it('answers 409 while items are unanswered', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'))
    const res = await request(app).post(`/api/projects/${P}/submit`).set('Authorization', as.aud)
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/every checklist item/)
    expect(project(P).submissionStatus).toBe('not_submitted')
  })

  it('submits a fully answered audit for review and opens its report', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'), answer(P, PI2, U.aud, 'not_applicable'))
    const res = await request(app).post(`/api/projects/${P}/submit`).set('Authorization', as.aud)
    expect(res.status).toBe(200)
    expect(project(P)).toMatchObject({ submissionStatus: 'pending_review', projectStatus: 'under_review' })
    expect(tables.Audit_Report).toEqual([expect.objectContaining({ projectId: P, userId: U.head })])
  })

  it('answers 409 when already submitted', async () => {
    tables.Audit_Result.push(answer(LOCKED, LI1, U.aud, 'compliant', LG))
    const res = await request(app).post(`/api/projects/${LOCKED}/submit`).set('Authorization', as.aud)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('This audit has already been submitted for review.')
  })

  it('answers 403 to a head auditor and to an outsider', async () => {
    expect((await request(app).post(`/api/projects/${P}/submit`).set('Authorization', as.head)).status).toBe(403)
    expect((await request(app).post(`/api/projects/${P}/submit`).set('Authorization', as.outsider)).status).toBe(403)
  })
})

describe('POST /api/projects/:id/review', () => {
  it('answers 400 without approved, 403 to another head auditor and 409 when not awaiting review', async () => {
    expect((await request(app).post(`/api/projects/${LOCKED}/review`).set('Authorization', as.head).send({ approved: 'yes' })).status).toBe(400)
    expect((await request(app).post(`/api/projects/${LOCKED}/review`).set('Authorization', as.headOther).send({ approved: true })).status).toBe(403)
    expect((await request(app).post(`/api/projects/${LOCKED}/review`).set('Authorization', as.aud).send({ approved: true })).status).toBe(403)
    const notAwaiting = await request(app).post(`/api/projects/${P}/review`).set('Authorization', as.head).send({ approved: false })
    expect(notAwaiting.status).toBe(409)
    expect(notAwaiting.body.error).toBe('This audit is not awaiting review.')
  })

  it('answers 409 when approving with unanswered items, but lets the audit be sent back', async () => {
    const approve = await request(app).post(`/api/projects/${LOCKED}/review`).set('Authorization', as.head).send({ approved: true })
    expect(approve.status).toBe(409)
    const reject = await request(app).post(`/api/projects/${LOCKED}/review`).set('Authorization', as.head).send({ approved: false, remarks: 'Add evidence' })
    expect(reject.status).toBe(200)
    expect(project(LOCKED)).toMatchObject({ submissionStatus: 'rejected', projectStatus: 'in_progress', submissionRemarks: 'Add evidence' })
  })

  it('approves a fully answered audit', async () => {
    tables.Audit_Result.push(answer(LOCKED, LI1, U.aud, 'compliant', LG))
    const res = await request(app).post(`/api/projects/${LOCKED}/review`).set('Authorization', as.head).send({ approved: true })
    expect(res.status).toBe(200)
    expect(project(LOCKED)).toMatchObject({ submissionStatus: 'approved', projectStatus: 'completed', submissionRemarks: null })
    expect(tables.Audit_Report.map((r) => r.projectId)).toEqual([LOCKED])
  })
})

describe('GET /api/projects/:id/compliance-scores', () => {
  it('scores each attached guideline from the effective answers', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'), answer(P, PI2, U.aud, 'partially'))
    const res = await request(app).get(`/api/projects/${P}/compliance-scores`).set('Authorization', as.aud)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ guidelineId: PG, shortName: 'OSC', totalItems: 2, answeredItems: 2, compliantItems: 1, nonCompliantItems: 1, weightedCompliant: 1.5, scorePercentage: 75 })
  })

  it('answers 403 to an outsider', async () => {
    expect((await request(app).get(`/api/projects/${P}/compliance-scores`).set('Authorization', as.outsider)).status).toBe(403)
  })
})

describe('reports', () => {
  beforeEach(() => {
    tables.Audit_Report.push({ reportId: 'rep-1', projectId: LOCKED, userId: U.head, timeGenerated: '2026-06-01T00:00:00Z' })
  })

  it('GET lists the reports of the caller\'s projects with filters', async () => {
    const all = await request(app).get('/api/reports').set('Authorization', as.head)
    expect(all.status).toBe(200)
    expect(all.body).toHaveLength(1)
    expect(all.body[0]).toMatchObject({ projectId: LOCKED, headAuditorName: 'Hana Head', guidelineIds: [LG], timeCreated: '2026-06-01T00:00:00Z' })

    expect((await request(app).get('/api/reports?search=discord').set('Authorization', as.aud)).body).toHaveLength(1)
    expect((await request(app).get('/api/reports?search=tiktok').set('Authorization', as.aud)).body).toHaveLength(0)
    expect((await request(app).get('/api/reports?projectStatusFilter=completed').set('Authorization', as.head)).body).toHaveLength(0)
    expect((await request(app).get('/api/reports?dateFrom=2026-07-01').set('Authorization', as.head)).body).toHaveLength(0)
    expect((await request(app).get('/api/reports?dateTo=2026-07-01').set('Authorization', as.head)).body).toHaveLength(1)
    expect((await request(app).get('/api/reports').set('Authorization', as.outsider)).body).toEqual([])
  })

  it('POST creates a report for a member and answers 403 to anyone else', async () => {
    const res = await request(app).post('/api/reports').set('Authorization', as.aud).send({ projectId: P })
    expect(res.status).toBe(201)
    expect(tables.Audit_Report.find((r) => r.projectId === P)?.reportId).toBe(res.body.reportId)
    expect((await request(app).post('/api/reports').set('Authorization', as.outsider).send({ projectId: P })).status).toBe(403)
    expect((await request(app).post('/api/reports').set('Authorization', as.aud).send({})).status).toBe(403)
    expect((await request(app).post('/api/reports').set('Authorization', as.aud).send({ projectId: id(999) })).status).toBe(403)
  })

  it('POST answers 409 when the project already has a report', async () => {
    const res = await request(app).post('/api/reports').set('Authorization', as.head).send({ projectId: LOCKED })
    expect(res.status).toBe(409)
  })
})
