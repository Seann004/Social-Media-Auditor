import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables, tables } from '../../helpers/fakeSupabase.js'

process.env.JWT_SECRET = 'a-test-secret-that-is-at-least-32-chars-long'

vi.mock('../../../src/config/supabase.js', async () => {
  const fake = await import('../../helpers/fakeSupabase.js')
  return { supabase: fake.supabase }
})

const { createMappingRouter } = await import('../../../src/routes/mappingRoutes.js')
const { signToken } = await import('../../../src/middleware/auth.js')

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
      { itemId: p2c, checklistId: 'pc1', category: 'Age', originalItemId: g1a, itemDescription: 'Age verification restricts minors' },
      { itemId: p2a, checklistId: 'pc2', category: 'Age', originalItemId: g2a, itemDescription: 'Age assurance restricts children' },
    ],
    Audit_Project: [
      { projectId: P2, projectTitle: 'TikTok 2026', headAuditorId: HEAD, smPlatform: 'tiktok', submissionStatus: 'not_submitted' },
      { projectId: OTHER_PROJECT, projectTitle: 'Other', headAuditorId: HEAD_OTHER, smPlatform: 'tiktok', submissionStatus: 'not_submitted' },
    ],
    Project_Member: [{ projectId: P2, userId: AUD }],
    Item_Mapping: [
      { mappingId: M1, itemIdA: g1a, itemIdB: g2a, relation: 'equivalent', confidence: 0.9, rationale: 'same duty', status: 'confirmed', createdAt: '2026-01-01T00:00:00Z' },
      { mappingId: M_OUTSIDE, itemIdA: g2a, itemIdB: g3a, relation: 'partial', confidence: 0.6, rationale: 'overlap', status: 'suggested', createdAt: '2026-01-02T00:00:00Z' },
    ],
    Audit_Result: [
      { resultId: 'r1', projectId: P2, itemId: p2c, userId: AUD, result: 'compliant', findings: 'Age gate seen', evidenceCount: 0, timeSubmitted: '2026-03-01T00:00:00Z' },
    ],
    Checklist_Resolution: [],
    Suggestion_Decision: [],
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

describe('POST /guidelines/:id/mappings/generate (admin only)', () => {
  it('lets an admin compare a guideline with all the others and saves the pairs as suggested', async () => {
    tables.Item_Mapping = []
    const res = await request(makeApp()).post(`/api/guidelines/${G1}/mappings/generate`).set('Authorization', as.admin)
    expect(res.status).toBe(200)
    expect(res.body.suggested).toBe(1)
    expect(tables.Item_Mapping).toEqual([expect.objectContaining({ status: 'suggested', confidence: 0.9 })])
  })

  it('sends the AI the items of the other guidelines, not only those in a project', async () => {
    tables.Item_Mapping = []
    await request(makeApp()).post(`/api/guidelines/${G1}/mappings/generate`).set('Authorization', as.admin)
    expect(ask.mock.calls.map(([, u]) => u).join(' ')).toMatch(/teenagers/)
  })

  it('refuses auditors, head auditors and anyone signed out', async () => {
    const app = makeApp()
    for (const who of [as.aud, as.head]) {
      expect((await request(app).post(`/api/guidelines/${G1}/mappings/generate`).set('Authorization', who)).status).toBe(403)
    }
    expect((await request(app).post(`/api/guidelines/${G1}/mappings/generate`)).status).toBe(401)
    expect((await request(app).post('/api/guidelines/nope/mappings/generate').set('Authorization', as.admin)).status).toBe(400)
    expect(ask).not.toHaveBeenCalled()
  })

  it('answers 404 for a guideline without items', async () => {
    const res = await request(makeApp()).post(`/api/guidelines/${id(98)}/mappings/generate`).set('Authorization', as.admin)
    expect(res.status).toBe(404)
  })

  it('answers 502 with a readable message when the AI fails', async () => {
    tables.Item_Mapping = []
    ask.mockRejectedValue(new Error('Groq down'))
    const res = await request(makeApp()).post(`/api/guidelines/${G1}/mappings/generate`).set('Authorization', as.admin)
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/AI matching failed/)
  })

  it('answers 409 while the same guideline is already being checked, then allows it again', async () => {
    tables.Item_Mapping = []
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    ask.mockImplementation(async () => { await gate; return { matches: [] } })
    const app = makeApp()

    const first = request(app).post(`/api/guidelines/${G1}/mappings/generate`).set('Authorization', as.admin).then((r) => r)
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())
    const second = await request(app).post(`/api/guidelines/${G1}/mappings/generate`).set('Authorization', as.admin)
    expect(second.status).toBe(409)

    release()
    expect((await first).status).toBe(200)
    expect((await request(app).post(`/api/guidelines/${G1}/mappings/generate`).set('Authorization', as.admin)).status).toBe(200)
  })
})

describe('GET /mappings (admin only)', () => {
  it('lists the pairs awaiting review by default, with both items, the learned score and usage', async () => {
    const res = await request(makeApp()).get('/api/mappings').set('Authorization', as.admin)
    expect(res.status).toBe(200)
    expect(res.body.items.map((m: { mappingId: string }) => m.mappingId)).toEqual([M_OUTSIDE])
    expect(res.body.items[0]).toMatchObject({
      confidence: 0.6, learnedConfidence: expect.any(Number), level: 'medium', usage: { together: 0 },
      itemA: { guidelineName: 'UKCC' }, itemB: { guidelineName: 'EDPB' },
    })
    expect(res.body).toMatchObject({ total: 1, counts: { suggested: 1, confirmed: 1, rejected: 0 }, levels: { high: 0, medium: 1, low: 0 } })
  })

  it('lists one confidence level when asked, and still counts every level', async () => {
    const app = makeApp()
    const medium = await request(app).get('/api/mappings?level=medium').set('Authorization', as.admin)
    expect(medium.body.items).toHaveLength(1)
    expect(medium.body.total).toBe(1)
    const high = await request(app).get('/api/mappings?level=high').set('Authorization', as.admin)
    expect(high.body.items).toEqual([])
    expect(high.body.total).toBe(0)
    expect(high.body.levels).toEqual({ high: 0, medium: 1, low: 0 })
    expect((await request(app).get('/api/mappings?level=extreme').set('Authorization', as.admin)).status).toBe(400)
  })

  it('shows the pairs of another status when asked', async () => {
    const res = await request(makeApp()).get('/api/mappings?status=confirmed').set('Authorization', as.admin)
    expect(res.body.items.map((m: { mappingId: string }) => m.mappingId)).toEqual([M1])
    expect(res.body.items[0].usage).toEqual({ projectsA: 1, projectsB: 1, together: 1 })
  })

  it('can be limited to one guideline, one relation or the pairs in use', async () => {
    const app = makeApp()
    const get = (q: string) => request(app).get(`/api/mappings?status=confirmed${q}`).set('Authorization', as.admin)
    expect((await get(`&guidelineId=${G1}`)).body.total).toBe(1)
    expect((await get(`&guidelineId=${G3}`)).body.total).toBe(0)
    expect((await get('&relation=partial')).body.total).toBe(0)
    expect((await get('&inUse=true')).body.total).toBe(1)
  })

  it('pages the list', async () => {
    const res = await request(makeApp()).get('/api/mappings?status=confirmed&limit=1&offset=1').set('Authorization', as.admin)
    expect(res.body.items).toEqual([])
    expect(res.body.total).toBe(1)
  })

  it('rejects filters and paging that are not valid', async () => {
    const app = makeApp()
    for (const q of ['guidelineId=x', 'status=maybe', 'relation=same', 'inUse=maybe', 'limit=0', 'limit=1000', 'limit=x', 'offset=-1']) {
      expect((await request(app).get(`/api/mappings?${q}`).set('Authorization', as.admin)).status, q).toBe(400)
    }
  })

  it('refuses everyone but an admin', async () => {
    const app = makeApp()
    expect((await request(app).get('/api/mappings').set('Authorization', as.head)).status).toBe(403)
    expect((await request(app).get('/api/mappings').set('Authorization', as.aud)).status).toBe(403)
    expect((await request(app).get('/api/mappings')).status).toBe(401)
  })
})

describe('GET /mappings/learning (admin only)', () => {
  it('reports how the AI has done so far', async () => {
    const res = await request(makeApp()).get('/api/mappings/learning').set('Authorization', as.admin)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ decided: 1, approved: 1, rejected: 0 })
    expect(res.body.bands).toEqual([expect.objectContaining({ relation: 'equivalent', fromPercent: 90, decided: 1, approved: 1 })])
  })

  it('refuses everyone but an admin', async () => {
    expect((await request(makeApp()).get('/api/mappings/learning').set('Authorization', as.head)).status).toBe(403)
    expect((await request(makeApp()).get('/api/mappings/learning')).status).toBe(401)
  })
})

describe('POST /mappings/bulk (admin only)', () => {
  const post = (body: object, who = as.admin) => request(makeApp()).post('/api/mappings/bulk').set('Authorization', who).send(body)

  it('decides a list of pairs', async () => {
    const res = await post({ ids: [M_OUTSIDE], status: 'rejected' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ updated: 1 })
    expect(tables.Item_Mapping.find((m) => m.mappingId === M_OUTSIDE)).toMatchObject({ status: 'rejected', reviewedBy: ADMIN })
  })

  it('decides everything a filter matches when the count is what the admin saw', async () => {
    const res = await post({ filter: { status: 'suggested', level: 'medium' }, expectedCount: 1, status: 'confirmed' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ updated: 1 })
  })

  it('answers 409 and changes nothing when the list is not the one the admin saw', async () => {
    const res = await post({ filter: { status: 'suggested', level: 'medium' }, expectedCount: 5, status: 'confirmed' })
    expect(res.status).toBe(409)
    expect(res.body.actual).toBe(1)
    expect(tables.Item_Mapping.find((m) => m.mappingId === M_OUTSIDE)!.status).toBe('suggested')
  })

  it('needs exactly one of ids and filter, a valid status and relation, and an expected count with a filter', async () => {
    expect((await post({ status: 'confirmed' })).status).toBe(400)
    expect((await post({ ids: [M1], filter: {}, expectedCount: 1, status: 'confirmed' })).status).toBe(400)
    expect((await post({ ids: [M1], status: 'maybe' })).status).toBe(400)
    expect((await post({ ids: [M1], status: 'confirmed', relation: 'same' })).status).toBe(400)
    expect((await post({ ids: [], status: 'confirmed' })).status).toBe(400)
    expect((await post({ ids: ['nope'], status: 'confirmed' })).status).toBe(400)
    expect((await post({ filter: { status: 'suggested' }, status: 'confirmed' })).status).toBe(400)
    expect((await post({ filter: { status: 'suggested' }, expectedCount: 99999, status: 'confirmed' })).status).toBe(400)
    expect((await post({ filter: { level: 'extreme' }, expectedCount: 1, status: 'confirmed' })).status).toBe(400)
  })

  it('refuses everyone but an admin, and changes nothing', async () => {
    expect((await post({ ids: [M_OUTSIDE], status: 'confirmed' }, as.head)).status).toBe(403)
    expect((await post({ ids: [M_OUTSIDE], status: 'confirmed' }, as.aud)).status).toBe(403)
    expect((await request(makeApp()).post('/api/mappings/bulk').send({ ids: [M_OUTSIDE], status: 'confirmed' })).status).toBe(401)
    expect(tables.Item_Mapping.find((m) => m.mappingId === M_OUTSIDE)!.status).toBe('suggested')
  })
})

describe('PATCH /mappings/:id (admin approves or rejects)', () => {
  it('records the decision and who made it', async () => {
    const res = await request(makeApp()).patch(`/api/mappings/${M_OUTSIDE}`).set('Authorization', as.admin).send({ status: 'confirmed', relation: 'equivalent' })
    expect(res.status).toBe(200)
    const row = tables.Item_Mapping.find((m) => m.mappingId === M_OUTSIDE)!
    expect(row).toMatchObject({ status: 'confirmed', relation: 'equivalent', reviewedBy: ADMIN })
    expect(row.reviewedAt).toBeTruthy()
  })

  it('refuses everyone but an admin and leaves the pair alone', async () => {
    const app = makeApp()
    expect((await request(app).patch(`/api/mappings/${M_OUTSIDE}`).set('Authorization', as.head).send({ status: 'confirmed' })).status).toBe(403)
    expect((await request(app).patch(`/api/mappings/${M_OUTSIDE}`).set('Authorization', as.aud).send({ status: 'confirmed' })).status).toBe(403)
    expect(tables.Item_Mapping.find((m) => m.mappingId === M_OUTSIDE)!.status).toBe('suggested')
  })

  it('rejects a bad id, status or relation, and answers 404 for an unknown pair', async () => {
    const app = makeApp()
    const patch = (path: string, body: object) => request(app).patch(path).set('Authorization', as.admin).send(body)
    expect((await patch('/api/mappings/nope', { status: 'confirmed' })).status).toBe(400)
    expect((await patch(`/api/mappings/${M1}`, { status: 'maybe' })).status).toBe(400)
    expect((await patch(`/api/mappings/${M1}`, { status: 'confirmed', relation: 'same' })).status).toBe(400)
    expect((await patch(`/api/mappings/${id(97)}`, { status: 'confirmed' })).status).toBe(404)
  })
})

describe('the old project button is gone', () => {
  it('no longer answers on it', async () => {
    const app = makeApp()
    expect((await request(app).post(`/api/projects/${P2}/similar-items`).set('Authorization', as.aud)).status).toBe(404)
  })
})

describe('GET /projects/:id/similar-items', () => {
  it('lists the approved pairs inside the project for its auditor and its head auditor', async () => {
    const app = makeApp()
    for (const who of [as.aud, as.head]) {
      const res = await request(app).get(`/api/projects/${P2}/similar-items`).set('Authorization', who)
      expect(res.status).toBe(200)
      expect(res.body.map((m: { mappingId: string }) => m.mappingId)).toEqual([M1])
      expect(res.body[0]).toMatchObject({ projectItemIdA: p2c, projectItemIdB: p2a })
    }
  })

  it('leaves out pairs that are not approved', async () => {
    const row = tables.Item_Mapping.find((m) => m.mappingId === M1)!
    for (const status of ['suggested', 'rejected']) {
      row.status = status
      const res = await request(makeApp()).get(`/api/projects/${P2}/similar-items`).set('Authorization', as.aud)
      expect(res.body).toEqual([])
    }
  })

  it('refuses people who are not on the project', async () => {
    expect((await request(makeApp()).get(`/api/projects/${P2}/similar-items`).set('Authorization', as.audOutsider)).status).toBe(403)
    expect((await request(makeApp()).get(`/api/projects/${P2}/similar-items`)).status).toBe(401)
  })
})

describe('suggestion routes', () => {
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
