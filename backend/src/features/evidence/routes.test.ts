import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessions } from '../auth/session.js'
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
