import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/fakeSupabase.js'
import { coreWorld, U } from '../../fixtures/coreWorld.js'
import { fetchMock, groqReply, loadCoreServer, quietConsole } from '../../helpers/coreServer.js'

vi.mock('dotenv/config', () => ({}))
vi.mock('dotenv', () => ({ default: { config: () => ({}) }, config: () => ({}) }))
vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

const { app, bearer } = await loadCoreServer()
const { getAiUsage, resetAiUsage } = await import('../../../src/lib/aiUsage.js')

const as = { admin: bearer(U.admin, 'admin'), head: bearer(U.head, 'head_auditor') }
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

const CHUNK = [
  'Section 4 Providers must verify the age of every user before an account is created.',
  'Clause 7 Platforms should ensure that chat requests from strangers are blocked for children.',
  'Too short.',
  'Services shall collect only the personal data needed to run the service for a child user.',
].join('\n')

beforeEach(() => {
  resetTables(coreWorld())
  fetchMock.mockReset()
  resetAiUsage()
  process.env.GROQ_API_KEY = 'test-groq-key'
  quietConsole()
})
afterEach(() => vi.restoreAllMocks())

function sentBody(call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as unknown as [string, RequestInit]
  return { url, init, body: JSON.parse(String(init.body)) }
}

describe('POST /api/generator/process-chunk', () => {
  it('answers 401 without a token and 403 to a head auditor', async () => {
    expect((await request(app).post('/api/generator/process-chunk').send({ textChunk: 'x' })).status).toBe(401)
    expect((await request(app).post('/api/generator/process-chunk').set('Authorization', as.head).send({ textChunk: 'x' })).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 400 without text or with a non-string platform', async () => {
    expect((await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({})).status).toBe(400)
    expect((await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({ textChunk: 5 })).status).toBe(400)
    expect((await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({ textChunk: 'x', platform: 1 })).status).toBe(400)
  })

  it('answers 500 when GROQ_API_KEY is not set', async () => {
    delete process.env.GROQ_API_KEY
    const res = await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({ textChunk: 'x' })
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/GROQ_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the chunk to Groq and answers the items it extracted', async () => {
    const items = [{ id: 'c1', category: 'Age Gate', text: 'Is age verified?', severity: 'critical', reference: 'Section 4', helpText: 'h' }]
    fetchMock.mockResolvedValueOnce(groqReply({ items }))
    const res = await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({ textChunk: CHUNK, platform: 'TikTok' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items, _aiUsed: true })
    const { url, init, body } = sentBody()
    expect(url).toBe(GROQ_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-groq-key')
    expect(body.model).toBe('test-model')
    expect(body.messages[0].content).toContain('TikTok')
    expect(body.messages[1].content).toContain('Section 4 Providers must verify')
    expect(getAiUsage()).toEqual([{ feature: 'extraction', model: 'test-model', calls: 1, inputTokens: 10, outputTokens: 5 }])
  })

  it('answers no items when Groq returns none', async () => {
    fetchMock.mockResolvedValueOnce(groqReply({}))
    const res = await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({ textChunk: CHUNK })
    expect(res.body).toEqual({ items: [], _aiUsed: true })
  })

  it('waits out a 429 and tries again', async () => {
    fetchMock
      .mockResolvedValueOnce(groqReply('slow down', 429, { 'retry-after': '0.01' }))
      .mockResolvedValueOnce(groqReply({ items: [{ id: 'a' }] }))
    const res = await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({ textChunk: CHUNK })
    expect(res.body).toEqual({ items: [{ id: 'a' }], _aiUsed: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the keyword parser when Groq answers an error', async () => {
    fetchMock.mockResolvedValueOnce(groqReply('model overloaded', 503))
    const res = await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({ textChunk: CHUNK })
    expect(res.status).toBe(200)
    expect(res.body._aiUsed).toBe(false)
    expect(res.body._fallbackReason).toContain('Groq API error: model overloaded')
    expect(res.body.items).toHaveLength(3)
    const [age, dm, data] = res.body.items
    expect(age).toMatchObject({ category: 'Age Gate', severity: 'critical', reference: 'Section 4', text: 'Section 4 Providers must verify the age of every user before an account is created' })
    expect(dm).toMatchObject({ category: 'Direct Messaging', severity: 'major', reference: 'Clause 7' })
    expect(data).toMatchObject({ category: 'Data Safety', severity: 'critical', reference: 'Clause Reference' })
    expect(age.helpText).toContain('Section 4 Providers must verify')
  })

  it('falls back when the network fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const text = 'Platforms must filter harmful content shown to children under rule 3 of this code\nUsers should not see nudge patterns that push them to stay online longer'
    const res = await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({ textChunk: text })
    expect(res.body._aiUsed).toBe(false)
    expect(res.body.items.map((i: any) => [i.category, i.reference])).toEqual([
      ['Content Filtering', 'rule 3'],
      ['Dark Patterns', 'Clause Reference'],
    ])
  })

  // A full stop between digits is part of a clause number ("Section 4.2"), not the end of a sentence.
  it('keeps a dotted clause number as the reference of a fallback item', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const text = 'Section 4.2 Providers must verify the age of every user before an account is created.'
    const res = await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({ textChunk: text })
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({ reference: 'Section 4.2', text: 'Section 4.2 Providers must verify the age of every user before an account is created' })
  })

  // Category words match whole words only: "message", "page" and "usage" contain "age" but are not about age.
  it('files a sentence about direct messages under Direct Messaging', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const text = 'Platforms should ensure that direct message requests from strangers are blocked for children'
    const res = await request(app).post('/api/generator/process-chunk').set('Authorization', as.admin).send({ textChunk: text })
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].category).toBe('Direct Messaging')
  })
})

describe('POST /api/generator/merge-items', () => {
  const raw = [
    { id: 'a', category: 'Age', text: 'Verify the age of users', severity: 'critical', reference: '1' },
    { id: 'b', category: 'Age', text: 'verify the AGE of users!', severity: 'major' },
    { id: 'c', category: 'Privacy', text: 'Default child accounts to private' },
    { text: '' },
  ]

  it('answers 403 to a head auditor, 400 for bad items or platform, and [] for no items', async () => {
    expect((await request(app).post('/api/generator/merge-items').set('Authorization', as.head).send({ items: raw })).status).toBe(403)
    expect((await request(app).post('/api/generator/merge-items').set('Authorization', as.admin).send({ items: 'x' })).status).toBe(400)
    expect((await request(app).post('/api/generator/merge-items').set('Authorization', as.admin).send({ items: [{ text: 5 }] })).status).toBe(400)
    expect((await request(app).post('/api/generator/merge-items').set('Authorization', as.admin).send({ items: [null] })).status).toBe(400)
    expect((await request(app).post('/api/generator/merge-items').set('Authorization', as.admin).send({ items: raw, platform: 3 })).status).toBe(400)
    const empty = await request(app).post('/api/generator/merge-items').set('Authorization', as.admin).send({ items: [] })
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual([])
  })

  it('answers 500 when GROQ_API_KEY is not set', async () => {
    delete process.env.GROQ_API_KEY
    expect((await request(app).post('/api/generator/merge-items').set('Authorization', as.admin).send({ items: raw })).status).toBe(500)
  })

  it('sends Groq the items without duplicates and answers its merged framework', async () => {
    const merged = { name: 'Code', shortName: 'C', categories: ['Age'], items: [{ id: 'm1', text: 'Verify age' }] }
    fetchMock.mockResolvedValueOnce(groqReply(merged))
    const res = await request(app).post('/api/generator/merge-items').set('Authorization', as.admin).send({ items: raw, platform: 'Discord' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...merged, _aiUsed: true })
    const { body } = sentBody()
    expect(body.messages[0].content).toContain('Discord')
    const sentItems = JSON.parse(body.messages[1].content.split('\n\n')[1])
    expect(sentItems.map((i: any) => i.id)).toEqual(['a', 'c'])
    expect(sentItems[1].reference).toBe('')
  })

  it('merges locally when Groq fails', async () => {
    fetchMock.mockResolvedValueOnce(groqReply('bad key', 401))
    const res = await request(app).post('/api/generator/merge-items').set('Authorization', as.admin).send({ items: raw })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ shortName: 'AADC-CODE', categories: ['Age', 'Privacy'], _aiUsed: false })
    expect(res.body.items.map((i: any) => i.id)).toEqual(['a', 'c'])
    expect(res.body.items[1]).toMatchObject({ severity: 'major', reference: 'N/A', category: 'Privacy' })
    expect(res.body.items[1].helpText).toContain('Default child accounts to private')
  })

  it('names a General category when nothing survives the local merge', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const res = await request(app).post('/api/generator/merge-items').set('Authorization', as.admin).send({ items: [{ text: '!!!' }] })
    expect(res.body).toMatchObject({ categories: ['General'], items: [], _aiUsed: false })
  })
})
