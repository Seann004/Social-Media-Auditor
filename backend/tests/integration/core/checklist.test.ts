import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failNext, resetTables, tables } from '../../helpers/fakeSupabase.js'
import { answer, coreWorld, G, G2, id, LI1, LOCKED, P, PG, PI1, PI2, U } from '../../fixtures/coreWorld.js'
import { fetchMock, groqReply, loadCoreServer, quietConsole } from '../../helpers/coreServer.js'

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

const settle = () => new Promise((r) => setTimeout(r, 20))

beforeEach(() => {
  resetTables(coreWorld())
  fetchMock.mockReset()
  quietConsole()
})
afterEach(() => vi.restoreAllMocks())

describe('POST /api/guidelines', () => {
  const body = {
    guideline: { guidelineId: id(15), guidelineName: 'New Code', shortName: 'NC', version: '1', description: 'd', source: 's', categories: ['Age'], lastUpdated: '2026-05-01', userId: U.admin },
    items: [
      { id: id(61), category: 'Age', text: 'Sign-up asks for a birth date', severity: 'critical', reference: '1.1' },
      { id: id(62), category: 'Age', text: 'Teen accounts default to private', severity: 'major' },
    ],
  }

  it('saves the guideline, its library checklist and items, then maps it in the background', async () => {
    fetchMock.mockImplementation(async () => groqReply({ matches: [] }))
    const res = await request(app).post('/api/guidelines').set('Authorization', as.admin).send(body)
    expect(res.status).toBe(201)
    expect(tables.Guideline.find((g) => g.guidelineId === id(15))).toMatchObject({ guidelineName: 'New Code', userId: U.admin })
    const checklist = tables.Checklist.find((c) => c.guidelineId === id(15))!
    expect(checklist.projectId ?? null).toBeNull()
    expect(tables.Checklist_Item.filter((i) => i.checklistId === checklist.checklistId).map((i) => i.itemDescription))
      .toEqual(['Sign-up asks for a birth date', 'Teen accounts default to private'])
    await settle()
    // The background matching only ever talks to the stubbed Groq endpoint.
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toBe('https://api.groq.com/openai/v1/chat/completions')
  })

  it('answers 400 without a guideline id or name, or without an items array', async () => {
    expect((await request(app).post('/api/guidelines').set('Authorization', as.admin).send({ items: [] })).status).toBe(400)
    expect((await request(app).post('/api/guidelines').set('Authorization', as.admin).send({ guideline: { guidelineId: 'x' }, items: [] })).status).toBe(400)
    expect((await request(app).post('/api/guidelines').set('Authorization', as.admin).send({ guideline: body.guideline, items: 'x' })).status).toBe(400)
  })

  it.each([
    ['an item id that is not a UUID', { ...body.items[0], id: 'FTG-1' }],
    ['an item without text', { ...body.items[0], text: '  ' }],
    ['an item without a category', { ...body.items[0], category: '' }],
    ['an item that is not an object', null],
  ])('answers 400 for %s, before writing anything', async (_label, badItem) => {
    const res = await request(app).post('/api/guidelines').set('Authorization', as.admin)
      .send({ ...body, items: [body.items[1], badItem] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/item 2/i)
    expect(tables.Guideline.find((g) => g.guidelineId === id(15))).toBeUndefined()
  })

  it('answers 403 to a head auditor and 409 for an id that exists', async () => {
    expect((await request(app).post('/api/guidelines').set('Authorization', as.head).send(body)).status).toBe(403)
    const dup = await request(app).post('/api/guidelines').set('Authorization', as.admin).send({ ...body, guideline: { ...body.guideline, guidelineId: G } })
    expect(dup.status).toBe(409)
  })
})

describe('GET /api/guidelines and items', () => {
  it('lists library guidelines with their item counts', async () => {
    tables.Guideline.find((g) => g.guidelineId === G)!.Checklist = [{ checklistId: 'gcl', projectId: null, Checklist_Item: [{ itemId: 'a' }, { itemId: 'b' }] }]
    const res = await request(app).get('/api/guidelines').set('Authorization', as.aud)
    expect(res.status).toBe(200)
    expect(res.body.map((g: any) => g.guidelineId).sort()).toEqual([G, G2].sort())
    expect(res.body.find((g: any) => g.guidelineId === G)).toMatchObject({ itemCount: 2, isDeleted: false })
    expect(res.body.find((g: any) => g.guidelineId === G2)).toMatchObject({ itemCount: 0, isDeleted: true })
  })

  it('lists the library items of a guideline in clause order, and none for an unknown one', async () => {
    const res = await request(app).get(`/api/guidelines/${G}/items`).set('Authorization', as.aud)
    expect(res.status).toBe(200)
    expect(res.body.map((i: any) => i.reference)).toEqual(['Clause 2', 'Clause 10'])
    expect((await request(app).get(`/api/guidelines/${id(999)}/items`).set('Authorization', as.aud)).body).toEqual([])
  })
})

describe('DELETE /api/guidelines/:id', () => {
  it('lets an admin delete a library guideline and refuses a head auditor', async () => {
    expect((await request(app).delete(`/api/guidelines/${G2}`).set('Authorization', as.head)).status).toBe(403)
    const res = await request(app).delete(`/api/guidelines/${G2}`).set('Authorization', as.admin)
    expect(res.status).toBe(200)
    expect(tables.Guideline.map((g) => g.guidelineId)).not.toContain(G2)
  })
})

describe('GET /api/projects/:id/checklist', () => {
  it('answers the active items of the project with their guideline', async () => {
    tables.Checklist_Item.find((i) => i.itemId === PI2)!.category = '__deactivated__Privacy'
    const res = await request(app).get(`/api/projects/${P}/checklist`).set('Authorization', as.aud)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ itemId: PI1, guidelineId: PG, category: 'Age' })
  })

  it('answers 403 to an outsider', async () => {
    expect((await request(app).get(`/api/projects/${P}/checklist`).set('Authorization', as.outsider)).status).toBe(403)
  })
})

describe('POST /api/projects/:id/checklist/items', () => {
  const item = { category: 'Age', text: 'A custom check', severity: 'minor', guidelineId: PG, reference: 'Custom 1' }

  it('adds a custom item to the project checklist', async () => {
    const res = await request(app).post(`/api/projects/${P}/checklist/items`).set('Authorization', as.head).send(item)
    expect(res.status).toBe(201)
    expect(tables.Checklist_Item.find((i) => i.itemId === res.body.itemId)).toMatchObject({ checklistId: 'pcl', itemDescription: 'A custom check', severity: 'minor', reference: 'Custom 1', helpText: null })
  })

  it('answers 400 for missing fields and a bad severity', async () => {
    expect((await request(app).post(`/api/projects/${P}/checklist/items`).set('Authorization', as.head).send({ ...item, text: '' })).status).toBe(400)
    const bad = await request(app).post(`/api/projects/${P}/checklist/items`).set('Authorization', as.head).send({ ...item, severity: 'huge' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('severity must be one of critical, major, minor.')
  })

  it('answers 403 to an auditor and while the audit is locked', async () => {
    expect((await request(app).post(`/api/projects/${P}/checklist/items`).set('Authorization', as.aud).send(item)).status).toBe(403)
    expect((await request(app).post(`/api/projects/${LOCKED}/checklist/items`).set('Authorization', as.head).send(item)).status).toBe(403)
  })

  it('answers 500 for a guideline the project does not have', async () => {
    const res = await request(app).post(`/api/projects/${P}/checklist/items`).set('Authorization', as.head).send({ ...item, guidelineId: G2 })
    expect(res.status).toBe(500)
  })
})

describe('POST /api/projects/:id/checklist/categories/toggle', () => {
  it('turns a category off and on again', async () => {
    const off = await request(app).post(`/api/projects/${P}/checklist/categories/toggle`).set('Authorization', as.head).send({ category: 'Age', guidelineId: PG, enabled: false })
    expect(off.status).toBe(200)
    expect(tables.Checklist_Item.find((i) => i.itemId === PI1)?.category).toBe('__deactivated__Age')
    await request(app).post(`/api/projects/${P}/checklist/categories/toggle`).set('Authorization', as.head).send({ category: 'Age', guidelineId: PG, enabled: true })
    expect(tables.Checklist_Item.find((i) => i.itemId === PI1)?.category).toBe('Age')
  })

  it('answers 400 for a bad body, 403 to an auditor and 403 while locked', async () => {
    expect((await request(app).post(`/api/projects/${P}/checklist/categories/toggle`).set('Authorization', as.head).send({ category: 'Age', guidelineId: PG, enabled: 'yes' })).status).toBe(400)
    expect((await request(app).post(`/api/projects/${P}/checklist/categories/toggle`).set('Authorization', as.aud).send({ category: 'Age', guidelineId: PG, enabled: false })).status).toBe(403)
    expect((await request(app).post(`/api/projects/${LOCKED}/checklist/categories/toggle`).set('Authorization', as.head).send({ category: 'Age', guidelineId: id(13), enabled: false })).status).toBe(403)
  })
})

describe('PATCH and DELETE /api/checklist/items/:id', () => {
  it('lets a head auditor in the project edit an item', async () => {
    const res = await request(app).patch(`/api/checklist/items/${PI1}`).set('Authorization', as.head).send({ itemDescription: 'Edited', severity: 'minor', checklistId: 'other' })
    expect(res.status).toBe(200)
    expect(tables.Checklist_Item.find((i) => i.itemId === PI1)).toMatchObject({ itemDescription: 'Edited', severity: 'minor', checklistId: 'pcl' })
  })

  it('answers 400 for a bad severity', async () => {
    expect((await request(app).patch(`/api/checklist/items/${PI1}`).set('Authorization', as.head).send({ severity: 'huge' })).status).toBe(400)
  })

  it('answers 404 for an unknown, malformed or library-only item, and 403 outside the project', async () => {
    expect((await request(app).patch(`/api/checklist/items/${id(999)}`).set('Authorization', as.head).send({})).status).toBe(404)
    expect((await request(app).patch('/api/checklist/items/nope').set('Authorization', as.head).send({})).status).toBe(404)
    expect((await request(app).patch(`/api/checklist/items/${G}`).set('Authorization', as.head).send({})).status).toBe(404)
    expect((await request(app).patch(`/api/checklist/items/${id(31)}`).set('Authorization', as.head).send({})).status).toBe(404)
    expect((await request(app).patch(`/api/checklist/items/${PI1}`).set('Authorization', as.headOther).send({})).status).toBe(403)
    expect((await request(app).patch(`/api/checklist/items/${PI1}`).set('Authorization', as.aud).send({})).status).toBe(403)
  })

  it('answers 403 when the item belongs to a locked audit', async () => {
    const res = await request(app).patch(`/api/checklist/items/${LI1}`).set('Authorization', as.head).send({ itemDescription: 'x' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/locked/)
  })

  it('answers 500 when the access check cannot read the database', async () => {
    failNext('Checklist_Item', 'select')
    expect((await request(app).patch(`/api/checklist/items/${PI1}`).set('Authorization', as.head).send({})).status).toBe(500)
  })

  it('deletes an item with its answers', async () => {
    tables.Audit_Result.push(answer(P, PI1, U.aud, 'compliant'), answer(P, PI2, U.aud, 'compliant'))
    const res = await request(app).delete(`/api/checklist/items/${PI1}`).set('Authorization', as.head)
    expect(res.status).toBe(200)
    expect(tables.Checklist_Item.map((i) => i.itemId)).not.toContain(PI1)
    expect(tables.Audit_Result.map((r) => r.itemId)).toEqual([PI2])
  })

  it('refuses to delete for another head auditor', async () => {
    expect((await request(app).delete(`/api/checklist/items/${PI1}`).set('Authorization', as.headOther)).status).toBe(403)
    expect(tables.Checklist_Item.map((i) => i.itemId)).toContain(PI1)
  })
})
