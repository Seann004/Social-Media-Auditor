import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessions } from '../auth/session.js'
import { MAX_DECISION_FINDINGS_CHARS, MAX_DECISION_NOTES_CHARS } from './config.js'
import { P1, P2, USERS, makeWorld, seedResult, type TestUser, type World } from './routesTestKit.js'

type Who = keyof typeof USERS

interface Seeded {
  runId: string
  suggestionId: string
  pageId: string
  quoteId: string
}

interface Endpoint {
  name: string
  method: 'get' | 'post' | 'put'
  path: (s: Seeded) => string
  body?: object
  ok: number
  allowed: Who[]
}

const BOTH: Who[] = ['head', 'auditor']
const ENDPOINTS: Endpoint[] = [
  { name: 'list sources', method: 'get', path: () => `/api/projects/${P1}/evidence-sources`, ok: 200, allowed: BOTH },
  { name: 'save sources', method: 'post', path: () => `/api/projects/${P1}/evidence-sources`, body: { startUrls: ['https://example.com/'] }, ok: 200, allowed: BOTH },
  { name: 'start a run', method: 'post', path: () => `/api/projects/${P1}/evidence-runs`, ok: 202, allowed: BOTH },
  { name: 're-assess', method: 'post', path: (s) => `/api/projects/${P1}/evidence-runs/${s.runId}/reassess`, body: {}, ok: 202, allowed: BOTH },
  { name: 'latest run', method: 'get', path: () => `/api/projects/${P1}/evidence-runs/latest`, ok: 200, allowed: BOTH },
  { name: 'suggestions', method: 'get', path: () => `/api/projects/${P1}/suggestions`, ok: 200, allowed: BOTH },
  { name: 'permission', method: 'put', path: () => `/api/projects/${P1}/evidence-permission`, body: { granted: true, note: 'Email from the platform' }, ok: 200, allowed: ['head'] },
  { name: 'decide', method: 'post', path: (s) => `/api/suggestions/${s.suggestionId}/decision`, body: { decision: 'accepted', origin: 'card' }, ok: 200, allowed: ['auditor'] },
  { name: 'page screenshot', method: 'get', path: (s) => `/api/evidence/screenshots/page/${s.pageId}`, ok: 200, allowed: BOTH },
  { name: 'quote screenshot', method: 'get', path: (s) => `/api/evidence/screenshots/quote/${s.quoteId}`, ok: 200, allowed: BOTH },
]

const WHO: Who[] = ['head', 'auditor', 'auditorP2', 'headP2', 'admin', 'stranger']

async function setup(): Promise<{ world: World; seeded: Seeded }> {
  const world = makeWorld()
  const seed = await seedResult(world.repo, P1)
  await world.repo.saveSource(P1, ['https://example.com/'], USERS.head.userId)
  // The signing itself is not under test here.
  vi.spyOn(world.repo, 'signedUrl').mockImplementation(async (path, seconds) => `https://signed.test/${path}?s=${seconds}`)
  return { world, seeded: { runId: seed.run.id, suggestionId: seed.suggestion.id, pageId: seed.pageId, quoteId: seed.quoteId } }
}

function send(world: World, e: Endpoint, seeded: Seeded, user?: TestUser) {
  let req = request(world.app)[e.method](e.path(seeded))
  if (user) req = req.set(world.auth(user))
  return e.body === undefined ? req : req.send(e.body)
}

const matrix = ENDPOINTS.flatMap((e) => WHO.map((who) => ({ e, who, status: e.allowed.includes(who) ? e.ok : 403 })))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('who may do what', () => {
  it.each(matrix)('$e.method $e.name as $who is $status', async ({ e, who, status }) => {
    const { world, seeded } = await setup()
    const res = await send(world, e, seeded, USERS[who])
    expect(res.status).toBe(status)
  })

  it('returns 401 without a token on every endpoint', async () => {
    const { world, seeded } = await setup()
    for (const e of ENDPOINTS) {
      const res = await send(world, e, seeded)
      expect(res.status, e.name).toBe(401)
    }
  })

  it('returns 401 for a token signed with another secret', async () => {
    const { world } = await setup()
    const other = createSessions('another-secret-that-is-also-32-chars-long!!')
    const res = await request(world.app)
      .get(`/api/projects/${P1}/suggestions`)
      .set({ Authorization: `Bearer ${other.sign(USERS.auditor)}` })
    expect(res.status).toBe(401)
  })

  it('ignores userId, projectId and itemId in the decision body and uses the token', async () => {
    const { world, seeded } = await setup()
    const res = await request(world.app)
      .post(`/api/suggestions/${seeded.suggestionId}/decision`)
      .set(world.auth(USERS.auditor))
      .send({ decision: 'accepted', origin: 'card', userId: 'u-evil', projectId: P2, itemId: 'item-2' })
    expect(res.status).toBe(200)
    expect(res.body.decision.userId).toBe(USERS.auditor.userId)
    expect(res.body.decision.itemId).toBe('item-1')
    expect(world.audit.applied).toMatchObject([{ projectId: P1, itemId: 'item-1', userId: USERS.auditor.userId }])
  })

  it('passes typed findings and notes to the answer, and nothing when they are absent', async () => {
    const { world, seeded } = await setup()
    const res = await request(world.app)
      .post(`/api/suggestions/${seeded.suggestionId}/decision`)
      .set(world.auth(USERS.auditor))
      .send({ decision: 'accepted', origin: 'answer_button', findings: 'typed findings', notes: 'typed notes' })
    expect(res.status).toBe(200)
    expect(world.audit.applied[0]).toMatchObject({ typedFindings: 'typed findings', notes: 'typed notes' })
    const { world: w2, seeded: s2 } = await setup()
    await request(w2.app).post(`/api/suggestions/${s2.suggestionId}/decision`).set(w2.auth(USERS.auditor)).send({ decision: 'accepted', origin: 'card' })
    expect(w2.audit.applied[0]).not.toHaveProperty('typedFindings')
    expect(w2.audit.applied[0]).not.toHaveProperty('notes')
  })

  it('an auditor of one project cannot decide a suggestion of another project', async () => {
    const { world } = await setup()
    const other = await seedResult(world.repo, P2)
    const res = await request(world.app)
      .post(`/api/suggestions/${other.suggestion.id}/decision`)
      .set(world.auth(USERS.auditor))
      .send({ decision: 'accepted', origin: 'card' })
    expect(res.status).toBe(403)
    expect(world.audit.applied).toHaveLength(0)
  })

  it('a decision on a suggestion that does not exist is 404', async () => {
    const { world } = await setup()
    const res = await request(world.app)
      .post('/api/suggestions/nope/decision')
      .set(world.auth(USERS.auditor))
      .send({ decision: 'accepted', origin: 'card' })
    expect(res.status).toBe(404)
  })
})

describe('validation', () => {
  it.each([
    ['too long', 'a'.repeat(65)],
    ['with a dot', 'p.1'],
    ['with an encoded slash', 'p%2F1'],
    ['with a space', 'p%201'],
  ])('rejects a project id %s with 400', async (_name, id) => {
    const { world } = await setup()
    const res = await request(world.app).get(`/api/projects/${id}/suggestions`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(400)
  })

  it.each([
    ['an internal address', 'http://127.0.0.1/'],
    ['a metadata address', 'http://169.254.169.254/latest/'],
    ['localhost', 'http://localhost:3000/'],
    ['a host that resolves privately', 'http://intranet.example.org/'],
    ['a non-http scheme', 'ftp://example.com/'],
    ['a file url', 'file:///etc/passwd'],
    ['a url with credentials', 'https://user:pw@example.com/'],
    ['not a url', 'hello'],
  ])('rejects %s as a start url with 400 and names it', async (_name, bad) => {
    const { world } = await setup()
    const res = await request(world.app)
      .post(`/api/projects/${P1}/evidence-sources`)
      .set(world.auth(USERS.auditor))
      .send({ startUrls: ['https://example.com/ok', bad] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/address 2/i)
    expect(await world.repo.getSource(P1)).toMatchObject({ startUrls: ['https://example.com/'] })
  })

  it('rejects more than 10 start urls, an empty list and a wrong shape with 400', async () => {
    const { world } = await setup()
    const eleven = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`)
    for (const body of [{ startUrls: eleven }, { startUrls: [] }, { startUrls: 'https://example.com' }, {}, { startUrls: [5] }]) {
      const res = await request(world.app).post(`/api/projects/${P1}/evidence-sources`).set(world.auth(USERS.auditor)).send(body)
      expect(res.status).toBe(400)
    }
  })

  it('checks start urls with a fresh guard each time', async () => {
    const { world } = await setup()
    const before = world.guardsMade.count
    await request(world.app).post(`/api/projects/${P1}/evidence-sources`).set(world.auth(USERS.auditor)).send({ startUrls: ['https://example.com/a'] })
    await request(world.app).post(`/api/projects/${P1}/evidence-sources`).set(world.auth(USERS.auditor)).send({ startUrls: ['https://example.com/b'] })
    expect(world.guardsMade.count - before).toBe(2)
  })

  it('saves valid start urls and returns them', async () => {
    const { world } = await setup()
    const res = await request(world.app)
      .post(`/api/projects/${P1}/evidence-sources`)
      .set(world.auth(USERS.head))
      .send({ startUrls: [' https://example.com/a ', 'https://www.example.com/b'] })
    expect(res.status).toBe(200)
    expect(res.body.source.startUrls).toEqual(['https://example.com/a', 'https://www.example.com/b'])
    const got = await request(world.app).get(`/api/projects/${P1}/evidence-sources`).set(world.auth(USERS.auditor))
    expect(got.body.source.startUrls).toEqual(['https://example.com/a', 'https://www.example.com/b'])
  })

  it.each([
    [{ decision: 'maybe', origin: 'card' }],
    [{ decision: 'accepted', origin: 'auto_match' }],
    [{ decision: 'accepted' }],
    [{ decision: 'overridden', origin: 'card', finalResult: 'bogus', overrideReason: 'because' }],
    [{ decision: 'overridden', origin: 'card', finalResult: 'non_compliant', overrideReason: 5 }],
    [{ decision: 'overridden', origin: 'card', finalResult: 'non_compliant', overrideReason: 'x'.repeat(2001) }],
    [{ decision: 'accepted', origin: 'card', findings: 5 }],
    [{ decision: 'accepted', origin: 'card', notes: { a: 1 } }],
    [{ decision: 'accepted', origin: 'card', findings: 'x'.repeat(MAX_DECISION_FINDINGS_CHARS + 1) }],
    [{ decision: 'accepted', origin: 'card', notes: 'x'.repeat(MAX_DECISION_NOTES_CHARS + 1) }],
  ])('rejects the decision body %j with 400', async (body) => {
    const { world, seeded } = await setup()
    const res = await request(world.app).post(`/api/suggestions/${seeded.suggestionId}/decision`).set(world.auth(USERS.auditor)).send(body)
    expect(res.status).toBe(400)
    expect(world.audit.applied).toHaveLength(0)
  })

  it('maps a rule of the decision to its status, not to 500', async () => {
    const { world, seeded } = await setup()
    const res = await request(world.app)
      .post(`/api/suggestions/${seeded.suggestionId}/decision`)
      .set(world.auth(USERS.auditor))
      .send({ decision: 'overridden', origin: 'card', finalResult: 'compliant', overrideReason: 'same as suggested' })
    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/suggested result/i)
  })

  it('a decision on a submitted audit is 409', async () => {
    const { world, seeded } = await setup()
    world.audit.submission.set(P1, 'pending_review')
    const res = await request(world.app).post(`/api/suggestions/${seeded.suggestionId}/decision`).set(world.auth(USERS.auditor)).send({ decision: 'accepted', origin: 'card' })
    expect(res.status).toBe(409)
  })

  it('validates the permission body', async () => {
    const { world } = await setup()
    for (const body of [{}, { granted: 'yes' }, { granted: true, note: 5 }, { granted: true, note: 'x'.repeat(501) }]) {
      const res = await request(world.app).put(`/api/projects/${P1}/evidence-permission`).set(world.auth(USERS.head)).send(body)
      expect(res.status).toBe(400)
    }
  })

  it('records and clears permission', async () => {
    const { world } = await setup()
    const on = await request(world.app).put(`/api/projects/${P1}/evidence-permission`).set(world.auth(USERS.head)).send({ granted: true, note: 'Written OK from the platform' })
    expect(on.body.permission).toMatchObject({ granted: true, note: 'Written OK from the platform', recordedBy: USERS.head.userId })
    const off = await request(world.app).put(`/api/projects/${P1}/evidence-permission`).set(world.auth(USERS.head)).send({ granted: false })
    expect(off.body.permission).toMatchObject({ granted: false, note: null })
    const got = await request(world.app).get(`/api/projects/${P1}/evidence-sources`).set(world.auth(USERS.auditor))
    expect(got.body.permission).toMatchObject({ granted: false })
  })
})

describe('what the browser is shown', () => {
  it('suggestions come from the latest completed or partial run, not a failed or running one', async () => {
    const { world } = await setup()
    const second = await seedResult(world.repo, P1, 'partial')
    const failed = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    await world.repo.updateRun(failed.id, { status: 'failed' })
    await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    const res = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    expect(res.body.run.id).toBe(second.run.id)
    expect(res.body.suggestions.map((s: { id: string }) => s.id)).toEqual([second.suggestion.id])
  })

  it('returns an empty result when nothing has finished', async () => {
    const world = makeWorld()
    const res = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ run: null, suggestions: [], decisions: [] })
  })

  it('adds the page and highlight to each quote and sends no storage path anywhere', async () => {
    const { world, seeded } = await setup()
    const res = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    const quote = res.body.suggestions[0].quotes[0]
    expect(quote).toMatchObject({ id: seeded.quoteId, pageUrl: 'https://example.com/privacy', pageTitle: 'Privacy', hasHighlight: true, verified: true })
    expect(JSON.stringify(res.body)).not.toMatch(/ScreenshotPath|quote\.jpg|page\.jpg|passageIdsSent/)
    const latest = await request(world.app).get(`/api/projects/${P1}/evidence-runs/latest`).set(world.auth(USERS.auditor))
    expect(JSON.stringify(latest.body)).not.toMatch(/screenshotPath|page\.jpg/)
    expect(latest.body.pages[0]).toMatchObject({ id: seeded.pageId, url: 'https://example.com/privacy', accessStatus: 'ok', hasScreenshot: true })
    expect(latest.body.pages[0]).not.toHaveProperty('text')
  })

  it('shows categories of a run by name, once each, in suggestions and latest', async () => {
    const { world } = await setup()
    const seed = await seedResult(world.repo, P1, 'partial')
    await world.repo.updateRun(seed.run.id, { unassessedCategories: ['g-1__Privacy', 'g-2__Privacy', 'g-1__Safety'] })
    const a = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    const b = await request(world.app).get(`/api/projects/${P1}/evidence-runs/latest`).set(world.auth(USERS.auditor))
    expect(a.body.run.unassessedCategories).toEqual(['Privacy', 'Safety'])
    expect(b.body.run.unassessedCategories).toEqual(['Privacy', 'Safety'])
  })

  it('the latest run is the newest run of any status, or null', async () => {
    const world = makeWorld()
    const none = await request(world.app).get(`/api/projects/${P1}/evidence-runs/latest`).set(world.auth(USERS.auditor))
    expect(none.body).toEqual({ run: null, pages: [] })
    const run = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    const res = await request(world.app).get(`/api/projects/${P1}/evidence-runs/latest`).set(world.auth(USERS.auditor))
    expect(res.body.run).toMatchObject({ id: run.id, status: 'queued' })
  })

  it('returns the latest decision per item with the suggested result, and no user name', async () => {
    const { world, seeded } = await setup()
    const base = { suggestionId: seeded.suggestionId, projectId: P1, itemId: 'item-1', origin: 'card' as const }
    await world.repo.addDecision({ ...base, userId: 'u-aud', decision: 'accepted', finalResult: 'compliant', overrideReason: null })
    await new Promise((r) => setTimeout(r, 5))
    await world.repo.addDecision({ ...base, userId: 'u-head', decision: 'overridden', finalResult: 'non_compliant', overrideReason: 'checked' })
    await world.repo.addDecision({ ...base, suggestionId: 'gone', itemId: 'item-9', userId: 'u-aud', decision: 'accepted', finalResult: 'compliant', overrideReason: null })
    const res = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    expect(res.body.decisions).toHaveLength(1)
    expect(res.body.decisions[0]).toMatchObject({ itemId: 'item-1', userId: 'u-head', decision: 'overridden', finalResult: 'non_compliant', suggestedResult: 'yes' })
    expect(res.body.decisions[0]).not.toHaveProperty('decidedByName')
  })

  it('returns the decision and the answer after a decision', async () => {
    const { world, seeded } = await setup()
    const res = await request(world.app).post(`/api/suggestions/${seeded.suggestionId}/decision`).set(world.auth(USERS.auditor)).send({ decision: 'accepted', origin: 'card' })
    expect(res.body.decision).toMatchObject({ suggestionId: seeded.suggestionId, finalResult: 'compliant', suggestedResult: 'yes' })
    expect(res.body.answer).toMatchObject({ itemId: 'item-1', status: 'compliant' })
  })
})

describe('screenshot links', () => {
  it('signs the close-up of a quote for 300 seconds', async () => {
    const { world, seeded } = await setup()
    const res = await request(world.app).get(`/api/evidence/screenshots/quote/${seeded.quoteId}`).set(world.auth(USERS.auditor))
    expect(res.body).toEqual({ url: expect.stringContaining('quote.jpg?s=300') })
  })

  it('falls back to the page picture when the quote has no close-up', async () => {
    const { world, seeded } = await setup()
    const q = (await world.repo.getQuote(seeded.quoteId))!
    vi.spyOn(world.repo, 'getQuote').mockResolvedValue({ ...q, highlightScreenshotPath: null })
    const res = await request(world.app).get(`/api/evidence/screenshots/quote/${seeded.quoteId}`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(200)
    expect(res.body.url).toContain('page.jpg?s=300')
  })

  it('answers 404 for no row and for a row without any picture', async () => {
    const { world } = await setup()
    for (const path of ['page/nope', 'quote/nope']) {
      const res = await request(world.app).get(`/api/evidence/screenshots/${path}`).set(world.auth(USERS.auditor))
      expect(res.status).toBe(404)
    }
    const run = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    const bare = await world.repo.addPage(run.id, { url: 'https://example.com/x', finalUrl: null, httpStatus: 200, accessStatus: 'ok', accessDetail: null, title: null, text: null, accessibilitySnapshot: null, screenshotPath: null, contentHash: null })
    const res = await request(world.app).get(`/api/evidence/screenshots/page/${bare.id}`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(404)
  })

  it('a link for another project is 403', async () => {
    const { world } = await setup()
    const other = await seedResult(world.repo, P2)
    for (const path of [`page/${other.pageId}`, `quote/${other.quoteId}`]) {
      const res = await request(world.app).get(`/api/evidence/screenshots/${path}`).set(world.auth(USERS.auditor))
      expect(res.status).toBe(403)
      expect(JSON.stringify(res.body)).not.toMatch(/jpg|https/)
    }
  })

  it('answers 500 without detail when signing fails', async () => {
    const { world, seeded } = await setup()
    vi.spyOn(world.repo, 'signedUrl').mockRejectedValue(new Error('signedUrl p-1/x.jpg: secret-service-key-abc exploded'))
    const res = await request(world.app).get(`/api/evidence/screenshots/page/${seeded.pageId}`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toMatch(/secret|exploded|jpg/)
  })
})

describe('errors', () => {
  it('never returns a stack, a database message or a key in an error body', async () => {
    const { world } = await setup()
    vi.spyOn(world.repo, 'latestResultRun').mockRejectedValue(new Error('relation "Evidence_Run" does not exist; key=eyJsecretServiceKey'))
    const res = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Something went wrong' })
  })

  it('answers 500 when the access check itself fails', async () => {
    const { world } = await setup()
    vi.spyOn(world.audit, 'getProjectAccess').mockRejectedValue(new Error('db down'))
    const res = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Something went wrong' })
  })

  it('answers bad JSON with a JSON error and an oversized body with 413', async () => {
    const { world, seeded } = await setup()
    const bad = await request(world.app)
      .post(`/api/projects/${P1}/evidence-sources`)
      .set(world.auth(USERS.auditor))
      .set('Content-Type', 'application/json')
      .send('{"startUrls": [')
    expect(bad.status).toBe(400)
    expect(bad.headers['content-type']).toMatch(/json/)
    expect(bad.body).toEqual({ error: 'Invalid request' })
    const big = await request(world.app)
      .post(`/api/suggestions/${seeded.suggestionId}/decision`)
      .set(world.auth(USERS.auditor))
      .send({ decision: 'accepted', origin: 'card', pad: 'x'.repeat(70_000) })
    expect(big.status).toBe(413)
    expect(big.body).toEqual({ error: 'Request too large' })
  })

  it('limits each user separately and answers 429 with an error', async () => {
    const world = makeWorld({ requestsPerMinute: 3 })
    const get = (u: TestUser) => request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(u))
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await get(USERS.auditor)).status)
    expect(statuses).toEqual([200, 200, 200, 429])
    expect((await get(USERS.head)).status).toBe(200)
    expect((await get(USERS.auditor)).body).toEqual({ error: expect.any(String) })
  })

  it('does not count a request without a valid token against anyone', async () => {
    const world = makeWorld({ requestsPerMinute: 2 })
    for (let i = 0; i < 5; i++) {
      expect((await request(world.app).get(`/api/projects/${P1}/suggestions`)).status).toBe(401)
    }
    expect((await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))).status).toBe(200)
  })
})

describe('review round 1', () => {
  it('a Head Auditor is let in by role, and a head role cannot ride on an auditor membership', async () => {
    const { world, seeded } = await setup()
    const headWithMemberRow = { userId: USERS.auditor.userId, role: 'head_auditor' }
    const res = await request(world.app)
      .post(`/api/suggestions/${seeded.suggestionId}/decision`)
      .set(world.auth(headWithMemberRow))
      .send({ decision: 'accepted', origin: 'card' })
    expect(res.status).toBe(403)
    const head = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.head))
    expect(head.status).toBe(200)
  })

  it('checks access before it says a screenshot row has no picture', async () => {
    const { world } = await setup()
    const run = await world.repo.createRun({ projectId: P2, startedBy: 'u-aud2', scope: 'all' })
    const bare = await world.repo.addPage(run.id, { url: 'https://example.com/x', finalUrl: null, httpStatus: 200, accessStatus: 'ok', accessDetail: null, title: null, text: null, accessibilitySnapshot: null, screenshotPath: null, contentHash: null })
    const res = await request(world.app).get(`/api/evidence/screenshots/page/${bare.id}`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(403)
  })

  it('a page view has exactly these keys, so nothing new can leak through', async () => {
    const { world } = await setup()
    const res = await request(world.app).get(`/api/projects/${P1}/evidence-runs/latest`).set(world.auth(USERS.auditor))
    expect(Object.keys(res.body.pages[0]).sort()).toEqual(
      ['accessDetail', 'accessStatus', 'capturedAt', 'finalUrl', 'hasScreenshot', 'httpStatus', 'id', 'title', 'url'],
    )
  })

  it('uses the final address of a page when it has one', async () => {
    const world = makeWorld()
    await seedResult(world.repo, P1, 'completed', 'https://example.com/privacy/final')
    const res = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    expect(res.body.suggestions[0].quotes[0].pageUrl).toBe('https://example.com/privacy/final')
  })

  it('after a re-assess, latest and suggestions still read the pages of the capture run', async () => {
    const { world, seeded } = await setup()
    const re = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'unfinished', capturedInRunId: seeded.runId })
    const original = (await world.repo.listSuggestions(seeded.runId))[0]
    await world.repo.addSuggestion({ ...original, runId: re.id, passageIdsSent: [], quotes: original.quotes.map(({ id: _id, ...q }) => q) })
    await world.repo.updateRun(re.id, { status: 'completed' })
    const latest = await request(world.app).get(`/api/projects/${P1}/evidence-runs/latest`).set(world.auth(USERS.auditor))
    expect(latest.body.run.id).toBe(re.id)
    expect(latest.body.pages.map((p: { id: string }) => p.id)).toEqual([seeded.pageId])
    const res = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    expect(res.body.run.id).toBe(re.id)
    expect(res.body.suggestions[0].quotes[0]).toMatchObject({ pageUrl: 'https://example.com/privacy', pageTitle: 'Privacy' })
  })

  it('saves the source with the signed-in user as its creator', async () => {
    const { world } = await setup()
    await request(world.app).post(`/api/projects/${P1}/evidence-sources`).set(world.auth(USERS.auditor)).send({ startUrls: ['https://example.com/z'] })
    expect((await world.repo.getSource(P1))?.createdBy).toBe(USERS.auditor.userId)
  })

  it('allows a busy user well past ten requests a minute with the default limit', async () => {
    const { world } = await setup()
    for (let i = 0; i < 40; i += 1) {
      const res = await request(world.app).get(`/api/projects/${P1}/evidence-runs/latest`).set(world.auth(USERS.auditor))
      expect(res.status).toBe(200)
    }
  })

  it('refuses every start address with the same words, so internal names cannot be probed', async () => {
    const { world } = await setup()
    const messages = new Set<string>()
    for (const bad of ['http://127.0.0.1/', 'http://localhost/', 'http://intranet.example.org/', 'http://unknown-host.invalid/', 'ftp://example.com/', 'https://u:p@example.com/', 'nope']) {
      const res = await request(world.app).post(`/api/projects/${P1}/evidence-sources`).set(world.auth(USERS.auditor)).send({ startUrls: [bad] })
      expect(res.status).toBe(400)
      messages.add(res.body.error)
    }
    expect(messages.size).toBe(1)
  })

  it('treats an id Postgres cannot cast as missing, not as a server error', async () => {
    const { world } = await setup()
    vi.spyOn(world.repo, 'getSuggestion').mockResolvedValue(null)
    const res = await request(world.app).post('/api/suggestions/not-a-uuid/decision').set(world.auth(USERS.auditor)).send({ decision: 'accepted', origin: 'card' })
    expect(res.status).toBe(404)
  })
})

describe('a failing database in every route family', () => {
  const SECRET_TEXT = 'SECRET-DB relation "Evidence_Run" key=eyJhbGciOi'

  function brokenRepo(world: World): World['repo'] {
    const entries = Object.entries(world.repo).map(([name, fn]) => [
      name,
      typeof fn === 'function'
        ? async () => {
            throw new Error(SECRET_TEXT)
          }
        : fn,
    ])
    return Object.fromEntries(entries) as World['repo']
  }

  const calls: { name: string; send: (w: World) => request.Test }[] = [
    { name: 'list sources', send: (w) => request(w.app).get(`/api/projects/${P1}/evidence-sources`).set(w.auth(USERS.auditor)) },
    { name: 'save sources', send: (w) => request(w.app).post(`/api/projects/${P1}/evidence-sources`).set(w.auth(USERS.auditor)).send({ startUrls: ['https://example.com/'] }) },
    { name: 'start a run', send: (w) => request(w.app).post(`/api/projects/${P1}/evidence-runs`).set(w.auth(USERS.auditor)) },
    { name: 're-assess', send: (w) => request(w.app).post(`/api/projects/${P1}/evidence-runs/r-1/reassess`).set(w.auth(USERS.auditor)).send({}) },
    { name: 'latest', send: (w) => request(w.app).get(`/api/projects/${P1}/evidence-runs/latest`).set(w.auth(USERS.auditor)) },
    { name: 'suggestions', send: (w) => request(w.app).get(`/api/projects/${P1}/suggestions`).set(w.auth(USERS.auditor)) },
    { name: 'permission', send: (w) => request(w.app).put(`/api/projects/${P1}/evidence-permission`).set(w.auth(USERS.head)).send({ granted: true }) },
    { name: 'decision', send: (w) => request(w.app).post('/api/suggestions/s-1/decision').set(w.auth(USERS.auditor)).send({ decision: 'accepted', origin: 'card' }) },
    { name: 'page screenshot', send: (w) => request(w.app).get('/api/evidence/screenshots/page/x-1').set(w.auth(USERS.auditor)) },
    { name: 'quote screenshot', send: (w) => request(w.app).get('/api/evidence/screenshots/quote/x-1').set(w.auth(USERS.auditor)) },
  ]

  it.each(calls)('$name answers a generic 500 and logs the cause', async ({ send }) => {
    const errors = vi.mocked(console.error)
    errors.mockClear()
    const world = makeWorld({ repo: brokenRepo(makeWorld()) })
    const res = await send(world)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Something went wrong' })
    expect(res.text).not.toMatch(/SECRET|Evidence_Run|eyJ/)
    expect(errors.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain('SECRET-DB')
  })
})

describe('a failure deep inside a route is not leaked either', () => {
  const SECRET_TEXT = 'SECRET-DB deep failure key=eyJhbGciOi'

  it.each([
    ['decision', (w: World) => vi.spyOn(w.audit, 'applyAnswer').mockRejectedValue(new Error(SECRET_TEXT)), (w: World, s: Seeded) => request(w.app).post(`/api/suggestions/${s.suggestionId}/decision`).set(w.auth(USERS.auditor)).send({ decision: 'accepted', origin: 'card' })],
    ['start', (w: World) => vi.spyOn(w.repo, 'createRun').mockRejectedValue(new Error(SECRET_TEXT)), (w: World) => request(w.app).post(`/api/projects/${P1}/evidence-runs`).set(w.auth(USERS.auditor))],
    ['re-assess', (w: World) => vi.spyOn(w.repo, 'createRun').mockRejectedValue(new Error(SECRET_TEXT)), (w: World, s: Seeded) => request(w.app).post(`/api/projects/${P1}/evidence-runs/${s.runId}/reassess`).set(w.auth(USERS.auditor)).send({})],
  ])('%s answers a generic 500', async (_name, breakIt, send) => {
    const { world, seeded } = await setup()
    breakIt(world)
    const res = await send(world, seeded)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Something went wrong' })
    expect(res.text).not.toMatch(/SECRET|eyJ/)
  })
})

describe('the polled routes read only the page columns they show', () => {
  it('latest and suggestions never read whole pages', async () => {
    const { world } = await setup()
    const whole = vi.spyOn(world.repo, 'listPages')
    const summaries = vi.spyOn(world.repo, 'listPageSummaries')
    await request(world.app).get(`/api/projects/${P1}/evidence-runs/latest`).set(world.auth(USERS.auditor))
    await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    expect(whole).not.toHaveBeenCalled()
    expect(summaries).toHaveBeenCalledTimes(2)
  })

  it('suggestions fetch the suggested results of other runs in one batch, not one by one', async () => {
    const { world, seeded } = await setup()
    const older = await seedResult(world.repo, P1)
    const base = { projectId: P1, userId: 'u-aud', decision: 'accepted' as const, finalResult: 'compliant' as const, overrideReason: null, origin: 'card' as const }
    await world.repo.addDecision({ ...base, suggestionId: older.suggestion.id, itemId: 'item-5' })
    await world.repo.addDecision({ ...base, suggestionId: seeded.suggestionId, itemId: 'item-1' })
    const one = vi.spyOn(world.repo, 'getSuggestion')
    const batch = vi.spyOn(world.repo, 'getSuggestedResults')
    const res = await request(world.app).get(`/api/projects/${P1}/suggestions`).set(world.auth(USERS.auditor))
    expect(res.body.decisions).toHaveLength(2)
    expect(one).not.toHaveBeenCalled()
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch).toHaveBeenCalledWith([seeded.suggestionId])
  })
})
