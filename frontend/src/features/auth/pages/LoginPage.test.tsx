import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, createSession } = vi.hoisted(() => ({ rpc: vi.fn(), createSession: vi.fn() }))

vi.mock('../../../lib/supabase', () => ({ supabase: { rpc } }))
vi.mock('../../../lib/crypto', () => ({ hashPassword: vi.fn(async () => 'hashed-password') }))
vi.mock('../../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/db')>()),
  createSession,
}))

import { useStore } from '../../../store/useStore'
import LoginPage from './LoginPage'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function signIn() {
  render(
    <MemoryRouter initialEntries={['/login']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<p>Dashboard page</p>} />
      </Routes>
    </MemoryRouter>,
  )
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), '  Alice@Example.COM ')
  await user.type(screen.getByLabelText('Password'), 'Passw0rd!')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
}

beforeEach(() => {
  localStorage.clear()
  rpc.mockReset()
  createSession.mockReset()
  rpc.mockResolvedValue({ data: [{ userId: 'u1', userName: 'Alice A', role: 'auditor' }], error: null })
  useStore.setState({
    isAuthenticated: false,
    currentUserId: '',
    sessionToken: null,
    users: [],
    initFromDb: vi.fn().mockResolvedValue(undefined),
  })
})

describe('LoginPage session token', () => {
  it('asks for a session with the same email and hash the RPC received, then stores the token', async () => {
    createSession.mockResolvedValue('tok-1')
    await signIn()
    await screen.findByText('Dashboard page')
    expect(rpc).toHaveBeenCalledWith('verify_user_login', { p_email: 'alice@example.com', p_password: 'hashed-password' })
    expect(createSession).toHaveBeenCalledWith('alice@example.com', 'hashed-password')
    await waitFor(() => expect(useStore.getState().sessionToken).toBe('tok-1'))
  })

  it('navigates without waiting for createSession', async () => {
    const pending = deferred<string>()
    createSession.mockReturnValue(pending.promise)
    await signIn()
    await screen.findByText('Dashboard page')
    expect(useStore.getState().sessionToken).toBeNull()
    await act(async () => pending.resolve('late'))
    expect(useStore.getState().sessionToken).toBe('late')
  })

  it('a rejected createSession does not stop login or navigation and leaves the token null', async () => {
    createSession.mockRejectedValue(new Error('503'))
    await signIn()
    await screen.findByText('Dashboard page')
    expect(useStore.getState().isAuthenticated).toBe(true)
    expect(useStore.getState().sessionToken).toBeNull()
  })

  it('a createSession that throws at once does not stop login either', async () => {
    createSession.mockImplementation(() => {
      throw new Error('boom')
    })
    await signIn()
    await screen.findByText('Dashboard page')
    expect(useStore.getState().sessionToken).toBeNull()
  })

  it('discards a token that arrives after logout', async () => {
    const pending = deferred<string>()
    createSession.mockReturnValue(pending.promise)
    await signIn()
    await screen.findByText('Dashboard page')
    act(() => useStore.getState().logout())
    await act(async () => pending.resolve('late'))
    expect(useStore.getState().sessionToken).toBeNull()
    expect(useStore.getState().isAuthenticated).toBe(false)
  })

  it('discards a token that arrives after another user logged in', async () => {
    const pending = deferred<string>()
    createSession.mockReturnValue(pending.promise)
    await signIn()
    await screen.findByText('Dashboard page')
    act(() => {
      useStore.getState().logout()
      useStore.getState().login('u2', 'Bob B', 'auditor')
    })
    await act(async () => pending.resolve('alice-late'))
    expect(useStore.getState().sessionToken).toBeNull()
    expect(useStore.getState().currentUserId).toBe('u2')
  })

  it('does not ask for a session when the login fails', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await signIn()
    await screen.findByText('Incorrect email or password.')
    expect(createSession).not.toHaveBeenCalled()
  })
})
