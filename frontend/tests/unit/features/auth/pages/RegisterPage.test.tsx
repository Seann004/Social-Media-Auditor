import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createUser } = vi.hoisted(() => ({ createUser: vi.fn() }))

vi.mock('../../../../../src/lib/crypto', () => ({ hashPassword: vi.fn(async () => 'hashed-password') }))
vi.mock('../../../../../src/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../src/lib/db')>()),
  createUser,
}))

import { useStore } from '../../../../../src/store/useStore'
import RegisterPage from '../../../../../src/features/auth/pages/RegisterPage'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/register']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<p>Dashboard page</p>} />
        <Route path="/" element={<p>Sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function fill(fields: { name?: string; email?: string; password?: string; confirm?: string } = {}) {
  const { name = 'Jane Smith', email = 'jane@example.com', password = 'Passw0rd!', confirm = password } = fields
  if (name) await user.type(screen.getByLabelText('Full Name'), name)
  if (email) await user.type(screen.getByLabelText('Email'), email)
  if (password) await user.type(screen.getByLabelText('Password'), password)
  if (confirm) await user.type(screen.getByLabelText('Confirm Password'), confirm)
}
const submit = () => user.click(screen.getByRole('button', { name: /Create account/ }))

// One user per test; typing does not wait between keys, which keeps the long forms fast.
let user: UserEvent

beforeEach(() => {
  user = userEvent.setup({ delay: null })
  localStorage.clear()
  createUser.mockReset().mockResolvedValue({ success: true, token: 'new-token' })
  useStore.setState({ isAuthenticated: false, currentUserId: '', authToken: null, users: [], loading: false, dbError: null })
})

describe('RegisterPage validation', () => {
  it('asks for a name first', async () => {
    mount()
    await submit()
    expect(screen.getByText('Please enter your full name.')).toBeInTheDocument()
    expect(createUser).not.toHaveBeenCalled()
  })

  it('asks for an email', async () => {
    mount()
    await fill({ email: '', password: '', confirm: '' })
    await submit()
    expect(screen.getByText('Please enter your email.')).toBeInTheDocument()
  })

  it('refuses a weak password and shows which rules fail', async () => {
    mount()
    await fill({ password: 'short' })
    await submit()
    expect(screen.getByText('Password does not meet the requirements below.')).toBeInTheDocument()
    expect(screen.getByText('At least 8 characters')).toHaveClass('text-slate-500')
    expect(screen.getByText('One uppercase letter (A to Z)')).toHaveClass('text-slate-500')
    expect(screen.getByText('One number (0 to 9)')).toHaveClass('text-slate-500')
    expect(screen.getByText('One symbol (e.g. _ ! @)')).toHaveClass('text-slate-500')
    expect(screen.getByLabelText('Password').className).toContain('border-rose-300')
  })

  it('ticks each password rule as it is met once the field is left', async () => {
    mount()
    await user.type(screen.getByLabelText('Password'), 'abcdefgh')
    expect(screen.queryByText('At least 8 characters')).toBeNull()
    await user.tab()
    expect(screen.getByText('At least 8 characters')).toHaveClass('text-emerald-600')
    expect(screen.getByText('One number (0 to 9)')).toHaveClass('text-slate-500')
    await user.type(screen.getByLabelText('Password'), 'A1!')
    expect(screen.getByText('One symbol (e.g. _ ! @)')).toHaveClass('text-emerald-600')
    expect(screen.getByLabelText('Password').className).toContain('border-emerald-300')
  })

  it('refuses passwords that do not match', async () => {
    mount()
    await fill({ confirm: 'Passw0rd?' })
    await submit()
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(createUser).not.toHaveBeenCalled()
  })

  it('clears the message when the user types again', async () => {
    mount()
    await submit()
    await user.type(screen.getByLabelText('Full Name'), 'J')
    await waitFor(() => expect(screen.queryByText('Please enter your full name.')).toBeNull())
  })
})

describe('RegisterPage submit', () => {
  it('registers an auditor by default with the trimmed name and hashed password, then goes to the dashboard', async () => {
    mount()
    await fill({ name: '  Jane Smith ' })
    await submit()
    expect(await screen.findByText('Account created successfully! Redirecting…')).toBeInTheDocument()
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
      userName: 'Jane Smith', userEmail: 'jane@example.com', role: 'auditor', userPassword: 'hashed-password',
    }))
    expect(useStore.getState()).toMatchObject({ isAuthenticated: true, authToken: 'new-token' })
    // The page waits 1.5 s on the success message before redirecting.
    expect(await screen.findByText('Dashboard page', {}, { timeout: 3000 })).toBeInTheDocument()
  }, 10_000)

  it('registers a head auditor when that role is picked', async () => {
    mount()
    await user.click(screen.getByLabelText(/Head Auditor/))
    expect(screen.getByLabelText(/Head Auditor/)).toBeChecked()
    await fill()
    await submit()
    await screen.findByText('Account created successfully! Redirecting…')
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'head_auditor' }))
  })

  it('shows a busy button while the account is being created', async () => {
    let finish!: (v: unknown) => void
    createUser.mockReturnValue(new Promise((r) => { finish = r }))
    mount()
    await fill()
    await submit()
    expect(await screen.findByRole('button', { name: /Creating account/ })).toBeDisabled()
    await act(async () => finish({ success: true, token: 't' }))
    expect(await screen.findByText('Account created successfully! Redirecting…')).toBeInTheDocument()
  })

  it.each([
    ['a duplicate email', new Error('duplicate key value violates unique constraint'), 'An account with this email already exists.'],
    ['an existing account in a JSON body', new Error(JSON.stringify({ error: 'User already exists' })), 'An account with this email already exists.'],
    ['a network failure', new TypeError('Failed to fetch'), 'Could not reach the server. Restart the backend and try again.'],
    ['any other server message', new Error('Role not allowed'), 'Role not allowed'],
    ['an empty error', new Error(''), 'Registration failed. Please try again.'],
  ])('explains %s', async (_name, error, message) => {
    createUser.mockRejectedValue(error)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mount()
    await fill()
    await submit()
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create account/ })).toBeEnabled()
    expect(useStore.getState().isAuthenticated).toBe(false)
  })

  it('links back to sign in', async () => {
    mount()
    await user.click(screen.getByRole('link', { name: 'Sign in' }))
    expect(await screen.findByText('Sign-in page')).toBeInTheDocument()
  })
})
