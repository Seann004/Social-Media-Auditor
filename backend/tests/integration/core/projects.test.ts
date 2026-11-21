import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failNext, resetTables, tables } from '../../helpers/fakeSupabase.js'
import { answer, coreWorld, id, LOCKED, OTHER, P, PG, PI1, PI2, U } from '../../fixtures/coreWorld.js'
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
  outsider: bearer(U.outsider, 'auditor'),
}

beforeEach(() => {
  resetTables(coreWorld())
  quietConsole()
})
afterEach(() => vi.restoreAllMocks())

describe('GET /api/projects', () => {
  it('lists the projects a head auditor leads, with members and guidelines', async () => {
    const res = await request(app).get('/api/projects').set('Authorization', as.head)
    expect(res.status).toBe(200)
    expect(res.body.map((p: any) => p.projectId).sort()).toEqual([P, LOCKED].sort())
    const p = res.body.find((x: any) => x.projectId === P)
    expect(p.memberIds.sort()).toEqual([U.aud, U.aud2].sort())
    expect(p.guidelineIds).toEqual([PG])
  })

  it('lists the projects an auditor is a member of, and none for an outsider', async () => {
    const aud = await request(app).get('/api/projects').set('Authorization', as.aud)
    expect(aud.body.map((p: any) => p.projectId).sort()).toEqual([P, LOCKED].sort())
    const outsider = await request(app).get('/api/projects').set('Authorization', as.outsider)
    expect(outsider.status).toBe(200)
    expect(outsider.body).toEqual([])
  })
})

describe('GET /api/projects/compliance-summary', () => {
  it('answers {} without ids', async () => {
    const res = await request(app).get('/api/projects/compliance-summary').set('Authorization', as.head)
    expect(res.body).toEqual({})
  })

  it('leaves out the projects the caller cannot see', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'))
    const res = await request(app).get(`/api/projects/compliance-summary?ids=${P},${OTHER}`).set('Authorization', as.head)
    expect(res.status).toBe(200)
    expect(Object.keys(res.body)).toEqual([P])
    expect(res.body[P]).toEqual({ percentage: 100, answered: 1, total: 2 })
  })
})

describe('GET /api/projects/:id', () => {
  it('answers the project with members, guidelines and scope to a member', async () => {
    tables.Project_Scope.push({ id: 's1', projectId: P, feature: 'Direct messages' })
    const res = await request(app).get(`/api/projects/${P}`).set('Authorization', as.aud)
    expect(res.status).toBe(200)
    expect(res.body.project.projectTitle).toBe('TikTok 2026')
    expect(res.body.members).toContainEqual({ userId: U.aud, userName: 'Ali Auditor', role: 'auditor' })
    expect(res.body.guidelines.map((g: any) => g.guidelineId)).toEqual([PG])
    expect(res.body.scope).toEqual(['Direct messages'])
  })

  it('answers 403 to someone outside the project, and 404 for an unknown or malformed id', async () => {
    expect((await request(app).get(`/api/projects/${P}`).set('Authorization', as.outsider)).status).toBe(403)
    expect((await request(app).get(`/api/projects/${P}`).set('Authorization', as.headOther)).status).toBe(403)
    expect((await request(app).get(`/api/projects/${id(999)}`).set('Authorization', as.head)).status).toBe(404)
    expect((await request(app).get('/api/projects/not-a-uuid').set('Authorization', as.head)).status).toBe(404)
  })

  it('answers 500 when the access check cannot read the database', async () => {
    failNext('Audit_Project', 'select')
    const res = await request(app).get(`/api/projects/${P}`).set('Authorization', as.head)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to verify project access')
  })
})

describe('POST /api/projects', () => {
  it('creates a draft project led by the calling head auditor', async () => {
    const res = await request(app).post('/api/projects').set('Authorization', as.head)
      .send({ title: 'YouTube 2026', platform: 'YouTube', notes: 'first pass', dueDate: '2026-12-31', headAuditorId: U.headOther })
    expect(res.status).toBe(201)
    const row = tables.Audit_Project.find((p) => p.projectId === res.body.projectId)!
    expect(row).toMatchObject({ projectTitle: 'YouTube 2026', smPlatform: 'YouTube', headAuditorId: U.head, projectStatus: 'draft', submissionStatus: 'not_submitted', projectNotes: 'first pass' })
  })

  it('answers 400 without a title or platform', async () => {
    expect((await request(app).post('/api/projects').set('Authorization', as.head).send({ platform: 'X' })).status).toBe(400)
    expect((await request(app).post('/api/projects').set('Authorization', as.head).send({ title: 'T', platform: 5 })).status).toBe(400)
  })

  it('answers 403 to an auditor and an admin', async () => {
    for (const who of [as.aud, as.admin]) {
      const res = await request(app).post('/api/projects').set('Authorization', who).send({ title: 'T', platform: 'X' })
      expect(res.status).toBe(403)
    }
    expect(tables.Audit_Project).toHaveLength(3)
  })
})

describe('PATCH /api/projects/:id', () => {
  it('lets the owner change only the editable fields', async () => {
    const res = await request(app).patch(`/api/projects/${P}`).set('Authorization', as.head)
      .send({ projectTitle: 'Renamed', projectNotes: 'n', dueDate: null, smPlatform: 'Instagram', projectStatus: 'in_progress', headAuditorId: U.headOther })
    expect(res.status).toBe(200)
    expect(tables.Audit_Project.find((p) => p.projectId === P)).toMatchObject({ projectTitle: 'Renamed', projectNotes: 'n', dueDate: null, smPlatform: 'Instagram', projectStatus: 'in_progress', headAuditorId: U.head })
  })

  it('answers 403 to another head auditor and to an auditor member', async () => {
    const other = await request(app).patch(`/api/projects/${P}`).set('Authorization', as.headOther).send({ projectTitle: 'x' })
    expect(other.status).toBe(403)
    expect(other.body.error).toBe("Only this project's head auditor can do that.")
    expect((await request(app).patch(`/api/projects/${P}`).set('Authorization', as.aud).send({ projectTitle: 'x' })).status).toBe(403)
    expect((await request(app).patch(`/api/projects/${id(999)}`).set('Authorization', as.head).send({ projectTitle: 'x' })).status).toBe(404)
  })

  it('answers 403 while the audit is under review (edit locked)', async () => {
    const res = await request(app).patch(`/api/projects/${LOCKED}`).set('Authorization', as.head).send({ projectTitle: 'x' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/locked/)
    expect(tables.Audit_Project.find((p) => p.projectId === LOCKED)?.projectTitle).toBe('Discord review')
  })
})

describe('POST /api/projects/:id/activate', () => {
  it('moves a draft project to in progress, and leaves other states alone', async () => {
    const res = await request(app).post(`/api/projects/${P}/activate`).set('Authorization', as.aud)
    expect(res.status).toBe(200)
    expect(tables.Audit_Project.find((p) => p.projectId === P)?.projectStatus).toBe('in_progress')
    await request(app).post(`/api/projects/${LOCKED}/activate`).set('Authorization', as.head)
    expect(tables.Audit_Project.find((p) => p.projectId === LOCKED)?.projectStatus).toBe('under_review')
  })

  it('answers 403 to an outsider', async () => {
    expect((await request(app).post(`/api/projects/${P}/activate`).set('Authorization', as.outsider)).status).toBe(403)
  })
})

describe('DELETE /api/projects/:id', () => {
  it('lets the owner delete the project', async () => {
    const res = await request(app).delete(`/api/projects/${P}`).set('Authorization', as.head)
    expect(res.status).toBe(200)
    expect(tables.Audit_Project.map((p) => p.projectId)).not.toContain(P)
  })

  it('answers 403 to another head auditor and to an auditor', async () => {
    expect((await request(app).delete(`/api/projects/${P}`).set('Authorization', as.headOther)).status).toBe(403)
    expect((await request(app).delete(`/api/projects/${P}`).set('Authorization', as.aud)).status).toBe(403)
    expect(tables.Audit_Project).toHaveLength(3)
  })

  it('answers 500 when the delete fails', async () => {
    failNext('Audit_Project', 'delete', { message: 'foreign key' })
    const res = await request(app).delete(`/api/projects/${P}`).set('Authorization', as.head)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('foreign key')
  })
})

describe('POST /api/projects/:id/scope', () => {
  it('replaces the scope features', async () => {
    tables.Project_Scope.push({ id: 's1', projectId: P, feature: 'Live' }, { id: 's2', projectId: P, feature: 'Chat' })
    const res = await request(app).post(`/api/projects/${P}/scope`).set('Authorization', as.head).send({ features: ['Chat', 'Search'] })
    expect(res.status).toBe(200)
    expect(tables.Project_Scope.filter((s) => s.projectId === P).map((s) => s.feature).sort()).toEqual(['Chat', 'Search'])
  })

  it('answers 400 for a bad body, 403 for an auditor and 403 when locked', async () => {
    expect((await request(app).post(`/api/projects/${P}/scope`).set('Authorization', as.head).send({ features: [1] })).status).toBe(400)
    expect((await request(app).post(`/api/projects/${P}/scope`).set('Authorization', as.aud).send({ features: [] })).status).toBe(403)
    expect((await request(app).post(`/api/projects/${LOCKED}/scope`).set('Authorization', as.head).send({ features: [] })).status).toBe(403)
  })
})

describe('project guidelines', () => {
  it('POST /api/projects/:id/guidelines attaches a library guideline and builds its checklist', async () => {
    const res = await request(app).post(`/api/projects/${P}/guidelines`).set('Authorization', as.head).send({ guidelineIds: [id(11), id(14)] })
    expect(res.status).toBe(200)
    const clones = tables.Guideline.filter((g) => g.projectId === P)
    expect(clones.map((g) => g.originalGuidelineId).sort()).toEqual([id(11), id(14)].sort())
  })

  it('answers 409 when removing a guideline that already has answers', async () => {
    tables.Audit_Result.push(answer(P, PI2, U.aud, 'compliant'))
    const res = await request(app).post(`/api/projects/${P}/guidelines`).set('Authorization', as.head).send({ guidelineIds: [] })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/recorded answers/)
  })

  it('answers 400 for a bad body and 403 for an auditor', async () => {
    expect((await request(app).post(`/api/projects/${P}/guidelines`).set('Authorization', as.head).send({ guidelineIds: 'x' })).status).toBe(400)
    expect((await request(app).post(`/api/projects/${P}/guidelines`).set('Authorization', as.aud).send({ guidelineIds: [] })).status).toBe(403)
  })
})
