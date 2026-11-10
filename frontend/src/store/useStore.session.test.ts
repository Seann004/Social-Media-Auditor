import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createUser } = vi.hoisted(() => ({ createUser: vi.fn() }))

vi.mock('../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db')>()),
  createUser,
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
  createUser.mockReset().mockResolvedValue({ token: 'register-token' })
  useStore.setState({
    isAuthenticated: false,
    currentUserId: '',
    authToken: null,
    responses: {},
    allResponses: {},
    resolutions: {},
    users: [],
  })
})

describe('auth token (one token for the app API and the evidence API)', () => {
  it('starts null, is set by login, and is cleared by logout', () => {
    expect(useStore.getState().authToken).toBeNull()
    useStore.getState().login('u1', 'Alice A', 'auditor', 'tok')
    expect(useStore.getState().authToken).toBe('tok')
    useStore.getState().logout()
    expect(useStore.getState().authToken).toBeNull()
  })

  it('is persisted with the rest of the session', () => {
    useStore.getState().login('u1', 'Alice A', 'auditor', 'tok')
    const saved = JSON.parse(localStorage.getItem('safetyaudit-session') ?? '{}')
    expect(saved.state.authToken).toBe('tok')
    expect(saved.state).not.toHaveProperty('sessionToken')
  })

  it('is replaced when a different user logs in', () => {
    useStore.getState().login('u1', 'Alice A', 'auditor', 'alice-token')
    useStore.getState().login('u2', 'Bob B', 'auditor', 'bob-token')
    expect(useStore.getState().authToken).toBe('bob-token')
  })

  it('is the token the backend returns for a registration', async () => {
    useStore.setState({ currentUserId: 'u1', isAuthenticated: true, authToken: 'alice-token' })
    await useStore.getState().register('b@example.com', 'Bob B', 'auditor', 'Secret_123')
    expect(useStore.getState().currentUserId).not.toBe('u1')
    expect(useStore.getState().authToken).toBe('register-token')
  })

  it('has no separate session token or session request any more', () => {
    const state = useStore.getState() as unknown as Record<string, unknown>
    expect(state.sessionToken).toBeUndefined()
    expect(state.setSessionToken).toBeUndefined()
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

  it('puts the result on every row of the item, the findings on mine, and shows my row', () => {
    const mine = entry({ status: 'compliant', findings: 'mine' })
    const theirs = entry({ id: 'r9', auditorId: 'u2', status: 'non_compliant', findings: 'theirs' })
    useStore.setState({
      currentUserId: 'u1',
      allResponses: { p1__i1: [theirs, mine] },
      responses: { p1__i1: { ...mine, status: 'needs_review' } },
    })
    useStore.getState().applyServerAnswer('p1', 'i1', { status: 'partially', findings: 'decided' })
    const rows = useStore.getState().allResponses['p1__i1']
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'partially')).toBe(true)
    expect(rows.find((r) => r.auditorId === 'u1')?.findings).toBe('decided')
    expect(rows.find((r) => r.auditorId === 'u2')?.findings).toBe('theirs')
    expect(useStore.getState().responses['p1__i1']).toMatchObject({ id: 'r1', status: 'partially', findings: 'decided' })
  })

  it('adds my row when only other auditors had answered', () => {
    const theirs = entry({ id: 'r9', auditorId: 'u2', status: 'compliant' })
    useStore.setState({ currentUserId: 'u1', allResponses: { p1__i1: [theirs] }, responses: { p1__i1: theirs } })
    useStore.getState().applyServerAnswer('p1', 'i1', { status: 'non_compliant', findings: null })
    const rows = useStore.getState().allResponses['p1__i1']
    expect(rows.map((r) => [r.auditorId, r.status])).toEqual([['u1', 'non_compliant'], ['u2', 'non_compliant']])
    expect(useStore.getState().responses['p1__i1'].status).toBe('non_compliant')
  })
})
