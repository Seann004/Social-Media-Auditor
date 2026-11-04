import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db')>()),
  createUser: vi.fn().mockResolvedValue(undefined),
}))

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
