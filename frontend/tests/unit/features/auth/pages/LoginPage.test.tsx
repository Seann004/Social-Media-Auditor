import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { login } = vi.hoisted(() => ({ login: vi.fn() }))

vi.mock('../../../../../src/lib/crypto', () => ({ hashPassword: vi.fn(async () => 'hashed-password') }))
vi.mock('../../../../../src/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../src/lib/db')>()),
  login,
}))

import { useStore } from '../../../../../src/store/useStore'
import LoginPage from '../../../../../src/features/auth/pages/LoginPage'

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
  login.mockReset()
  login.mockResolvedValue({ token: 'tok-1', user: { userId: 'u1', userName: 'Alice A', role: 'auditor' } })
  useStore.setState({
    isAuthenticated: false,
    currentUserId: '',
    authToken: null,
    users: [],
    initFromDb: vi.fn().mockResolvedValue(undefined),
  })
})

describe('LoginPage', () => {
  it('signs in through the backend login with the normalised email and hash, and stores its one token', async () => {
    await signIn()
    await screen.findByText('Dashboard page')
    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith('alice@example.com', 'hashed-password')
    const state = useStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.currentUserId).toBe('u1')
    // The same token serves the app API and the evidence API: there is no second session.
    expect(state.authToken).toBe('tok-1')
    expect('sessionToken' in state).toBe(false)
  })

  it('shows one message and stays signed out when the login fails', async () => {
    login.mockRejectedValue(new Error('Incorrect email or password.'))
    await signIn()
    await screen.findByText('Incorrect email or password.')
    expect(useStore.getState().isAuthenticated).toBe(false)
    expect(useStore.getState().authToken).toBeNull()
  })

  it('logout clears the token', async () => {
    await signIn()
    await screen.findByText('Dashboard page')
    useStore.getState().logout()
    expect(useStore.getState().authToken).toBeNull()
  })
})
