import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BASE_URL, login } from './db'
import { useStore } from '../store/useStore'

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

describe('login', () => {
  const user = { userId: 'u-1', userName: 'Ada', role: 'auditor' }

  it('posts { email, password } to /auth/login and returns { token, user }', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { token: 'tok-abc', user }))
    await expect(login('a@b.c', 'hashed')).resolves.toEqual({ token: 'tok-abc', user })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/auth/login`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.c', password: 'hashed' })
  })

  it('throws the server sentence when the server refuses, without logging anyone out', async () => {
    const logout = vi.spyOn(useStore.getState(), 'logout')
    fetchMock.mockResolvedValueOnce(reply(401, { error: 'Incorrect email or password.' }))
    await expect(login('a@b.c', 'hashed')).rejects.toThrow('Incorrect email or password.')
    expect(logout).not.toHaveBeenCalled()
  })
})

describe('the auth token', () => {
  const user = { userId: 'u-1', userName: 'Ada', role: 'auditor' }
  afterEach(() => useStore.setState({ authToken: null }))

  it('is sent as a Bearer header on the app API, the same token the evidence API uses', async () => {
    useStore.setState({ authToken: 'tok-main' })
    fetchMock.mockResolvedValueOnce(reply(200, { token: 'x', user }))
    await login('a@b.c', 'hashed')
    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-main')
  })
})
