import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createSession } = vi.hoisted(() => ({ createSession: vi.fn() }))

vi.mock('../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db')>()),
  createUser: vi.fn().mockResolvedValue(undefined),
  createSession,
}))
vi.mock('../lib/crypto', () => ({ hashPassword: vi.fn(async () => 'hashed-password') }))

import { useStore } from './useStore'
import type { AuditResponse } from '../types'

const entry = (over: Partial<AuditResponse> = {}): AuditResponse => ({
  id: 'r1',
  projectId: 'p1',
  checklistItemId: 'i1',
  status: 'not_started',
  notes: 'my notes',
  findings: 'my findings',
  auditorId: 'u1',
  updatedAt: '2026-11-01',
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  createSession.mockReset()
  useStore.setState({ isAuthenticated: false, currentUserId: '', sessionToken: null, responses: {}, users: [] })
})

describe('session token', () => {
  it('starts null, is set by setSessionToken, and is cleared by logout', () => {
    expect(useStore.getState().sessionToken).toBeNull()
    useStore.getState().setSessionToken('tok')
    expect(useStore.getState().sessionToken).toBe('tok')
    useStore.getState().logout()
    expect(useStore.getState().sessionToken).toBeNull()
  })

  it('is persisted with the rest of the session', () => {
    useStore.getState().setSessionToken('tok')
    const saved = JSON.parse(localStorage.getItem('safetyaudit-session') ?? '{}')
    expect(saved.state.sessionToken).toBe('tok')
  })

  it('does not survive a different user logging in', () => {
    useStore.getState().login('u1', 'Alice A', 'auditor')
    useStore.getState().setSessionToken('alice-token')
    useStore.getState().login('u2', 'Bob B', 'auditor')
    expect(useStore.getState().sessionToken).toBeNull()
  })

  it('does not survive a registration that signs in a new user', async () => {
    useStore.setState({ currentUserId: 'u1', isAuthenticated: true, sessionToken: 'alice-token' })
    await useStore.getState().register('b@example.com', 'Bob B', 'auditor')
    expect(useStore.getState().currentUserId).not.toBe('u1')
    expect(useStore.getState().sessionToken).toBeNull()
  })
})

describe('session token after registering', () => {
  const deferred = () => {
    let resolve!: (token: string) => void
    let reject!: (err: Error) => void
    const promise = new Promise<string>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
  const registerBob = () => useStore.getState().register('  Bob@Example.COM ', 'Bob B', 'auditor', 'Secret_123')
  const flush = () => new Promise((done) => setTimeout(done))

  it('asks for one as a login does, and stores it', async () => {
    createSession.mockResolvedValue('bob-token')
    await registerBob()
    await flush()
    expect(createSession).toHaveBeenCalledWith('bob@example.com', 'hashed-password')
    expect(useStore.getState().sessionToken).toBe('bob-token')
  })

  it('does not wait for it', async () => {
    const pending = deferred()
    createSession.mockReturnValue(pending.promise)
    await registerBob()
    expect(useStore.getState().isAuthenticated).toBe(true)
    expect(useStore.getState().sessionToken).toBeNull()
    pending.resolve('late')
    await flush()
    expect(useStore.getState().sessionToken).toBe('late')
  })

  it('still registers when the request fails', async () => {
    createSession.mockRejectedValue(new Error('503'))
    await expect(registerBob()).resolves.toBeUndefined()
    await flush()
    expect(useStore.getState().isAuthenticated).toBe(true)
    expect(useStore.getState().sessionToken).toBeNull()
  })

  it('discards a token that arrives after logout', async () => {
    const pending = deferred()
    createSession.mockReturnValue(pending.promise)
    await registerBob()
    useStore.getState().logout()
    pending.resolve('late')
    await flush()
    expect(useStore.getState().sessionToken).toBeNull()
  })

  it('discards a token that arrives after another user signed in', async () => {
    const pending = deferred()
    createSession.mockReturnValue(pending.promise)
    await registerBob()
    useStore.getState().login('u2', 'Alice A', 'auditor')
    pending.resolve('bob-late')
    await flush()
    expect(useStore.getState().sessionToken).toBeNull()
  })

  it('asks for none without a password', async () => {
    await useStore.getState().register('b@example.com', 'Bob B', 'auditor')
    await flush()
    expect(createSession).not.toHaveBeenCalled()
  })
})

describe('applyServerAnswer', () => {
  it('creates the entry when none exists yet', () => {
    useStore.getState().applyServerAnswer('p1', 'i1', { status: 'compliant', findings: 'from the page' })
    const created = useStore.getState().responses['p1__i1']
    expect(created).toMatchObject({ projectId: 'p1', checklistItemId: 'i1', status: 'compliant', findings: 'from the page' })
  })

  it('keeps every other field and replaces status and findings', () => {
    useStore.setState({ responses: { p1__i1: entry() } })
    useStore.getState().applyServerAnswer('p1', 'i1', { status: 'partially', findings: 'new findings' })
    expect(useStore.getState().responses['p1__i1']).toEqual(entry({ status: 'partially', findings: 'new findings' }))
  })

  it('keeps the stored findings when the server sends null', () => {
    useStore.setState({ responses: { p1__i1: entry() } })
    useStore.getState().applyServerAnswer('p1', 'i1', { status: 'non_compliant', findings: null })
    expect(useStore.getState().responses['p1__i1']).toEqual(entry({ status: 'non_compliant' }))
  })

  it('does not mutate the previous responses or entry, and leaves other items alone', () => {
    const other = entry({ id: 'r2', checklistItemId: 'i2' })
    const before = { p1__i1: entry(), p1__i2: other }
    const snapshot = structuredClone(before)
    useStore.setState({ responses: before })
    useStore.getState().applyServerAnswer('p1', 'i1', { status: 'compliant', findings: 'x' })
    const after = useStore.getState().responses
    expect(before).toEqual(snapshot)
    expect(after).not.toBe(before)
    expect(after['p1__i1']).not.toBe(before.p1__i1)
    expect(after['p1__i2']).toBe(other)
  })
})
