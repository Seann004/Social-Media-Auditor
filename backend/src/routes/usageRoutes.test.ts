import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.JWT_SECRET = 'a-test-secret-that-is-at-least-32-chars-long'

const { createUsageRouter } = await import('./usageRoutes.js')
const { signToken } = await import('../middleware/auth.js')
const { recordAiUsage, resetAiUsage } = await import('../lib/aiUsage.js')

const token = (role: 'admin' | 'head_auditor' | 'auditor') => `Bearer ${signToken({ userId: 'u1', userName: role, role })}`

function makeApp() {
  const app = express()
  app.use('/api', createUsageRouter())
  return app
}

beforeEach(() => {
  resetAiUsage()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('GET /admin/ai-usage', () => {
  it('shows the admin the tokens used per feature', async () => {
    recordAiUsage('evidence', 'm', { prompt_tokens: 40, completion_tokens: 10 })
    const res = await request(makeApp()).get('/api/admin/ai-usage').set('Authorization', token('admin'))
    expect(res.status).toBe(200)
    expect(res.body.usage).toEqual([{ feature: 'evidence', model: 'm', calls: 1, inputTokens: 40, outputTokens: 10 }])
  })

  it('is empty before any AI call', async () => {
    const res = await request(makeApp()).get('/api/admin/ai-usage').set('Authorization', token('admin'))
    expect(res.body.usage).toEqual([])
  })

  it('refuses everyone but an admin', async () => {
    const app = makeApp()
    expect((await request(app).get('/api/admin/ai-usage').set('Authorization', token('head_auditor'))).status).toBe(403)
    expect((await request(app).get('/api/admin/ai-usage').set('Authorization', token('auditor'))).status).toBe(403)
    expect((await request(app).get('/api/admin/ai-usage')).status).toBe(401)
  })
})
