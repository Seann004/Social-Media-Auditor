import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failNext, resetTables, tables } from '../../helpers/fakeSupabase.js'
import { coreWorld, id, LOCKED, OTHER, P, PI1, U } from '../../fixtures/coreWorld.js'

vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

const access = await import('../../../src/middleware/projectAccess.js')

/** A tiny app that puts `userId` from the x-user header on req.user, then runs one middleware. */
function appWith(path: string, middleware: express.RequestHandler) {
  const app = express()
  app.use((req, _res, next) => {
    req.user = { userId: String(req.headers['x-user']), userName: 'x', role: 'auditor' }
    next()
  })
  app.get(path, middleware, (_req, res) => { res.json({ ok: true }) })
  return app
}

beforeEach(() => {
  resetTables(coreWorld())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('isProjectMember and filterAccessibleProjectIds', () => {
  it('counts the head auditor and members, not others', async () => {
    expect(await access.isProjectMember(P, U.head)).toBe(true)
    expect(await access.isProjectMember(P, U.aud2)).toBe(true)
    expect(await access.isProjectMember(P, U.outsider)).toBe(false)
    expect(await access.isProjectMember('nope', U.head)).toBe(false)
  })

  it('keeps only the ids the user leads or belongs to, in the order asked', async () => {
    expect(await access.filterAccessibleProjectIds(U.head, [])).toEqual([])
    expect(await access.filterAccessibleProjectIds(U.aud, [OTHER, LOCKED, P])).toEqual([LOCKED, P])
    expect(await access.filterAccessibleProjectIds(U.headOther, [P, OTHER])).toEqual([OTHER])
  })

  it('throws when a read fails', async () => {
    failNext('Audit_Project')
    await expect(access.filterAccessibleProjectIds(U.aud, [P])).rejects.toBeTruthy()
    failNext('Project_Member')
    await expect(access.filterAccessibleProjectIds(U.aud, [P])).rejects.toBeTruthy()
    failNext('Project_Member')
    await expect(access.isProjectMember(P, U.aud)).rejects.toBeTruthy()
  })
})

describe('requireProjectAccess and requireProjectOwner', () => {
  it('answer 400 when the route has no such parameter', async () => {
    expect((await request(appWith('/x', access.requireProjectAccess('id'))).get('/x').set('x-user', U.head)).status).toBe(400)
    expect((await request(appWith('/x', access.requireProjectOwner('id'))).get('/x').set('x-user', U.head)).status).toBe(400)
  })

  it('requireProjectAccess reads the named parameter', async () => {
    const app = appWith('/p/:projectId', access.requireProjectAccess('projectId'))
    expect((await request(app).get(`/p/${P}`).set('x-user', U.aud)).status).toBe(200)
    expect((await request(app).get(`/p/${P}`).set('x-user', U.outsider)).status).toBe(403)
  })

  it('answer 500 when the membership read fails', async () => {
    failNext('Project_Member')
    const res = await request(appWith('/p/:id', access.requireProjectAccess())).get(`/p/${P}`).set('x-user', U.aud)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to verify project access')
  })

  it('requireProjectOwner lets only the head auditor in, and answers 404 and 500', async () => {
    const app = appWith('/p/:id', access.requireProjectOwner())
    expect((await request(app).get(`/p/${P}`).set('x-user', U.head)).status).toBe(200)
    expect((await request(app).get(`/p/${P}`).set('x-user', U.aud)).status).toBe(403)
    expect((await request(app).get(`/p/${id(999)}`).set('x-user', U.head)).status).toBe(404)
    expect((await request(app).get('/p/abc').set('x-user', U.head)).status).toBe(404)
    failNext('Audit_Project')
    expect((await request(app).get(`/p/${P}`).set('x-user', U.head)).status).toBe(500)
  })
})

describe('requireChecklistItemProjectAccess', () => {
  it('answers 400 without the parameter', async () => {
    expect((await request(appWith('/x', access.requireChecklistItemProjectAccess())).get('/x').set('x-user', U.head)).status).toBe(400)
  })

  it('answers 404 for an item whose checklist is gone, and 500 when the checklist read fails', async () => {
    const app = appWith('/i/:id', access.requireChecklistItemProjectAccess())
    tables.Checklist_Item.push({ itemId: id(70), checklistId: 'gone' })
    expect((await request(app).get(`/i/${id(70)}`).set('x-user', U.head)).status).toBe(404)
    failNext('Checklist')
    expect((await request(app).get(`/i/${PI1}`).set('x-user', U.head)).status).toBe(500)
    expect((await request(app).get(`/i/${PI1}`).set('x-user', U.aud)).status).toBe(200)
  })
})
