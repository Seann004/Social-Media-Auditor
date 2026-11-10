import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables, tables } from '../test/fakeSupabase.js'

process.env.JWT_SECRET = 'a-test-secret-that-is-at-least-32-chars-long'

vi.mock('../config/supabase.js', async () => {
  const fake = await import('../test/fakeSupabase.js')
  return { supabase: fake.supabase }
})

const { createMappingRouter } = await import('./mappingRoutes.js')
const { signToken } = await import('../middleware/auth.js')

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const ADMIN = id(1)
const HEAD = id(2)
const HEAD_OTHER = id(3)
const AUD = id(4)
const AUD_OUTSIDER = id(5)

const G1 = id(11)
const G2 = id(12)
const G3 = id(13)
const P2 = id(21)
const OTHER_PROJECT = id(22)
const M1 = id(31)
const M_OUTSIDE = id(32)
const g1a = id(41)
const g2a = id(42)
const g3a = id(43)
const p2a = id(51)
const p2c = id(52)

const token = (userId: string, role: 'admin' | 'head_auditor' | 'auditor') =>
  `Bearer ${signToken({ userId, userName: role, role })}`
const as = {
  admin: token(ADMIN, 'admin'),
  head: token(HEAD, 'head_auditor'),
  headOther: token(HEAD_OTHER, 'head_auditor'),
  aud: token(AUD, 'auditor'),
  audOutsider: token(AUD_OUTSIDER, 'auditor'),
}

const ask = vi.fn()

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api', createMappingRouter({ ask }))
  return app
}

function seed() {
  resetTables({
    Checklist: [
      { checklistId: 'gc1', guidelineId: G1, projectId: null, Guideline: { guidelineName: 'ONSA', shortName: 'ONSA' } },
      { checklistId: 'gc2', guidelineId: G2, projectId: null, Guideline: { guidelineName: 'UKCC', shortName: 'UKCC' } },
      { checklistId: 'gc3', guidelineId: G3, projectId: null, Guideline: { guidelineName: 'EDPB', shortName: 'EDPB' } },
      { checklistId: 'pc1', guidelineId: G1, projectId: P2, Guideline: { guidelineName: 'ONSA', shortName: 'ONSA' } },
      { checklistId: 'pc2', guidelineId: G2, projectId: P2, Guideline: { guidelineName: 'UKCC', shortName: 'UKCC' } },
    ],
    Checklist_Item: [
      { itemId: g1a, checklistId: 'gc1', category: 'Age', itemDescription: 'Age verification restricts minors from adult content' },
      { itemId: g2a, checklistId: 'gc2', category: 'Age', itemDescription: 'Age assurance restricts children from adult content' },
      { itemId: g3a, checklistId: 'gc3', category: 'Age', itemDescription: 'Age assurance for teenagers matches the risk' },
      { itemId: p2c, checklistId: 'pc1', category: 'Age', originalItemId: g1a },
      { itemId: p2a, checklistId: 'pc2', category: 'Age', originalItemId: g2a },
    ],
    Guideline: [
      { guidelineId: id(61), projectId: P2, originalGuidelineId: G1 },
      { guidelineId: id(62), projectId: P2, originalGuidelineId: G2 },
    ],
    Audit_Project: [
      { projectId: P2, projectTitle: 'TikTok 2026', headAuditorId: HEAD, smPlatform: 'tiktok', submissionStatus: 'not_submitted' },
      { projectId: OTHER_PROJECT, projectTitle: 'Other', headAuditorId: HEAD_OTHER, smPlatform: 'tiktok', submissionStatus: 'not_submitted' },
    ],
    Project_Member: [{ projectId: P2, userId: AUD }],
    Item_Mapping: [
      { mappingId: M1, itemIdA: g1a, itemIdB: g2a, relation: 'equivalent', confidence: 0.9, rationale: 'same duty', status: 'suggested', createdAt: '2026-01-01T00:00:00Z' },
      { mappingId: M_OUTSIDE, itemIdA: g2a, itemIdB: g3a, relation: 'partial', confidence: 0.6, rationale: 'overlap', status: 'suggested', createdAt: '2026-01-02T00:00:00Z' },
    ],
    Audit_Result: [
      { resultId: 'r1', projectId: P2, itemId: p2c, userId: AUD, result: 'compliant', findings: 'Age gate seen', evidenceCount: 0, timeSubmitted: '2026-03-01T00:00:00Z' },
    ],
    Checklist_Resolution: [],
    Suggestion_Decision: [],
    Project_Mapping_Decision: [],
  })
}

beforeEach(() => {
  seed()
  ask.mockReset()
  ask.mockImplementation(async (_s: string, user: string) => {
    const payload = JSON.parse(user) as { source: string; candidates: { candidate: string; text: string }[] }[]
    return { matches: payload.flatMap((p) => p.candidates.filter((c) => /age assurance restricts/i.test(c.text)).map((c) => ({ source: p.source, candidate: c.candidate, relation: 'equivalent', confidence: 0.9, reason: 'same duty' }))) }
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('admin routes', () => {
  it('lists links for an admin only', async () => {
    const app = makeApp()
    expect((await request(app).get('/api/mappings').set('Authorization', as.admin)).status).toBe(200)
    expect((await request(app).get('/api/mappings').set('Authorization', as.head)).status).toBe(403)
    expect((await request(app).get('/api/mappings')).status).toBe(401)
  })

  it('shows coverage to any signed-in user', async () => {
    const res = await request(makeApp()).get('/api/mappings/coverage').set('Authorization', as.aud)
    expect(res.status).toBe(200)
    expect(res.body.mappings).toEqual({ suggested: 2, confirmed: 0, rejected: 0 })
  })

  it('lets an admin confirm a shared link', async () => {
    const res = await request(makeApp()).patch(`/api/mappings/${M1}`).set('Authorization', as.admin).send({ status: 'confirmed', relation: 'equivalent' })
    expect(res.status).toBe(200)
    expect(tables.Item_Mapping.find((m) => m.mappingId === M1)).toMatchObject({ status: 'confirmed', reviewedBy: ADMIN })
  })

  it('refuses a head auditor on the shared review route', async () => {
    const res = await request(makeApp()).patch(`/api/mappings/${M1}`).set('Authorization', as.head).send({ status: 'confirmed' })
    expect(res.status).toBe(403)
  })

  it('rejects a bad status, a bad relation and a bad id', async () => {
    const app = makeApp()
    expect((await request(app).patch(`/api/mappings/${M1}`).set('Authorization', as.admin).send({ status: 'maybe' })).status).toBe(400)
    expect((await request(app).patch(`/api/mappings/${M1}`).set('Authorization', as.admin).send({ status: 'confirmed', relation: 'same' })).status).toBe(400)
    expect((await request(app).patch('/api/mappings/not-a-uuid').set('Authorization', as.admin).send({ status: 'confirmed' })).status).toBe(404)
  })

  it('lets an admin run the AI for one guideline against the whole library', async () => {
    tables.Item_Mapping = []
    const res = await request(makeApp()).post(`/api/guidelines/${G1}/mappings/generate`).set('Authorization', as.admin)
    expect(res.status).toBe(200)
    expect(res.body.suggested).toBe(1)
    expect((await request(makeApp()).post(`/api/guidelines/${G1}/mappings/generate`).set('Authorization', as.head)).status).toBe(403)
  })
})

describe('project link routes', () => {
  it('lists a project\'s links for its own head auditor', async () => {
    const res = await request(makeApp()).get(`/api/projects/${P2}/mappings`).set('Authorization', as.head)
    expect(res.status).toBe(200)
    expect(res.body.map((m: { mappingId: string }) => m.mappingId)).toEqual([M1])
  })

  it('keeps links outside the project out of the list', async () => {
    const res = await request(makeApp()).get(`/api/projects/${P2}/mappings`).set('Authorization', as.head)
    expect(res.body.map((m: { mappingId: string }) => m.mappingId)).not.toContain(M_OUTSIDE)
  })

  it('refuses another head auditor, an auditor and a stranger', async () => {
    const app = makeApp()
    expect((await request(app).get(`/api/projects/${P2}/mappings`).set('Authorization', as.headOther)).status).toBe(403)
    expect((await request(app).get(`/api/projects/${P2}/mappings`).set('Authorization', as.aud)).status).toBe(403)
    expect((await request(app).get(`/api/projects/${P2}/mappings`)).status).toBe(401)
  })

  it('answers 404 for a project that does not exist or is not an id', async () => {
    const app = makeApp()
    expect((await request(app).get(`/api/projects/${id(99)}/mappings`).set('Authorization', as.head)).status).toBe(404)
    expect((await request(app).get('/api/projects/nope/mappings').set('Authorization', as.head)).status).toBe(404)
  })

  it('records the head auditor\'s decision for this project and leaves the shared link alone', async () => {
    const res = await request(makeApp()).patch(`/api/projects/${P2}/mappings/${M1}`).set('Authorization', as.head).send({ status: 'confirmed', relation: 'equivalent' })
    expect(res.status).toBe(200)
    expect(tables.Project_Mapping_Decision).toEqual([expect.objectContaining({ projectId: P2, mappingId: M1, status: 'confirmed', decidedBy: HEAD })])
    expect(tables.Item_Mapping.find((m) => m.mappingId === M1)!.status).toBe('suggested')
  })

  it('refuses to decide a link that is outside the project', async () => {
    const res = await request(makeApp()).patch(`/api/projects/${P2}/mappings/${M_OUTSIDE}`).set('Authorization', as.head).send({ status: 'confirmed' })
    expect(res.status).toBe(404)
    expect(tables.Project_Mapping_Decision).toEqual([])
  })

  it('refuses another head auditor deciding for this project', async () => {
    const res = await request(makeApp()).patch(`/api/projects/${P2}/mappings/${M1}`).set('Authorization', as.headOther).send({ status: 'confirmed' })
    expect(res.status).toBe(403)
    expect(tables.Project_Mapping_Decision).toEqual([])
  })

  it('rejects a bad status, relation or link id', async () => {
    const app = makeApp()
    expect((await request(app).patch(`/api/projects/${P2}/mappings/${M1}`).set('Authorization', as.head).send({ status: 'nope' })).status).toBe(400)
    expect((await request(app).patch(`/api/projects/${P2}/mappings/${M1}`).set('Authorization', as.head).send({ status: 'confirmed', relation: 'x' })).status).toBe(400)
    expect((await request(app).patch(`/api/projects/${P2}/mappings/bad`).set('Authorization', as.head).send({ status: 'confirmed' })).status).toBe(404)
  })

  it('lets the head auditor ask the AI to find links for the project only', async () => {
    tables.Item_Mapping = []
    const res = await request(makeApp()).post(`/api/projects/${P2}/mappings/generate`).set('Authorization', as.head)
    expect(res.status).toBe(200)
    expect(res.body.suggested).toBe(1)
    const sent = ask.mock.calls.map(([, u]) => u).join(' ')
    expect(sent).not.toMatch(/teenagers/)
    expect((await request(makeApp()).post(`/api/projects/${P2}/mappings/generate`).set('Authorization', as.headOther)).status).toBe(403)
  })

  it('answers 502 with a readable message when the AI fails', async () => {
    tables.Item_Mapping = []
    ask.mockRejectedValue(new Error('Groq down'))
    const res = await request(makeApp()).post(`/api/projects/${P2}/mappings/generate`).set('Authorization', as.head)
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/AI matching failed/)
  })
})

describe('suggestion routes', () => {
  beforeEach(() => {
    tables.Item_Mapping[0].status = 'confirmed'
  })

  it('shows suggestions to a member of the project and hides them from outsiders', async () => {
    const app = makeApp()
    const ok = await request(app).get(`/api/projects/${P2}/suggestions`).set('Authorization', as.aud)
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual([expect.objectContaining({ itemId: p2a, relation: 'equivalent' })])
    expect((await request(app).get(`/api/projects/${P2}/suggestions`).set('Authorization', as.audOutsider)).status).toBe(403)
  })

  it('lets a member auditor accept and records the answer', async () => {
    const res = await request(makeApp()).post(`/api/projects/${P2}/suggestions/accept`).set('Authorization', as.aud).send({ itemIds: [p2a] })
    expect(res.status).toBe(200)
    expect(res.body.accepted).toEqual([expect.objectContaining({ itemId: p2a, result: 'compliant' })])
    expect(tables.Suggestion_Decision).toEqual([expect.objectContaining({ itemId: p2a, decision: 'accepted' })])
  })

  it('does not let a head auditor accept or dismiss', async () => {
    const app = makeApp()
    expect((await request(app).post(`/api/projects/${P2}/suggestions/accept`).set('Authorization', as.head).send({ itemIds: [p2a] })).status).toBe(403)
    expect((await request(app).post(`/api/projects/${P2}/suggestions/dismiss`).set('Authorization', as.head).send({ itemId: p2a, sourceItemId: p2c })).status).toBe(403)
  })

  it('rejects an accept without a proper list of item ids', async () => {
    const app = makeApp()
    for (const itemIds of [undefined, [], ['x'], [1], Array.from({ length: 501 }, () => id(70))]) {
      const res = await request(app).post(`/api/projects/${P2}/suggestions/accept`).set('Authorization', as.aud).send({ itemIds })
      expect(res.status).toBe(400)
    }
  })

  it('refuses to accept once the project is submitted for review', async () => {
    tables.Audit_Project[0].submissionStatus = 'pending_review'
    const res = await request(makeApp()).post(`/api/projects/${P2}/suggestions/accept`).set('Authorization', as.aud).send({ itemIds: [p2a] })
    expect(res.status).toBe(403)
  })

  it('dismisses a suggestion, and answers 404 for one that does not exist', async () => {
    const app = makeApp()
    const ok = await request(app).post(`/api/projects/${P2}/suggestions/dismiss`).set('Authorization', as.aud).send({ itemId: p2a, sourceItemId: p2c })
    expect(ok.status).toBe(200)
    const gone = await request(app).post(`/api/projects/${P2}/suggestions/dismiss`).set('Authorization', as.aud).send({ itemId: p2a, sourceItemId: p2c })
    expect(gone.status).toBe(404)
  })

  it('rejects a dismiss that is missing ids', async () => {
    const res = await request(makeApp()).post(`/api/projects/${P2}/suggestions/dismiss`).set('Authorization', as.aud).send({ itemId: p2a })
    expect(res.status).toBe(400)
  })
})
