import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BASE_URL, createSession } from './db'

const fetchMock = vi.fn()

const reply = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSession', () => {
  it('posts { email, password } to /auth/login and returns the token', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { token: 'tok-abc' }))
    await expect(createSession('a@b.c', 'hashed')).resolves.toBe('tok-abc')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/auth/login`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.c', password: 'hashed' })
  })

  it.each([
    ['an empty token', { token: '' }],
    ['a missing token', {}],
    ['a non-string token', { token: 123 }],
  ])('throws on %s', async (_label, body) => {
    fetchMock.mockResolvedValueOnce(reply(200, body))
    await expect(createSession('a@b.c', 'hashed')).rejects.toThrow(/session token/i)
  })

  it('throws when the server refuses', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, 'Invalid credentials'))
    await expect(createSession('a@b.c', 'hashed')).rejects.toThrow('Invalid credentials')
  })
})
