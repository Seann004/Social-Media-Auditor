import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useStore } from '../../../src/store/useStore'
import Topbar from '../../../src/layouts/Topbar'
import type { User } from '../../../src/types'

const USERS: User[] = [
  { id: 'h1', name: 'Hana Head', role: 'head_auditor', initials: 'HH', color: 'bg-violet-500' },
  { id: 'a1', name: 'Andy Auditor', role: 'auditor', initials: 'AA', color: 'bg-emerald-500' },
  { id: 'ad', name: 'Ada Admin', role: 'admin', initials: 'AD', color: 'bg-blue-600' },
]

function setup(role: User['role'] | null) {
  useStore.setState({
    isAuthenticated: true, authToken: 't',
    currentUserId: role ? USERS.find((u) => u.role === role)!.id : 'nobody', users: USERS,
  } as never)
}

function mount(onOpenMenu = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/dashboard" element={<Topbar onOpenMenu={onOpenMenu} />} />
        <Route path="/" element={<p>Sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe('Topbar', () => {
  it.each([
    [9, 'Good morning, Hana'],
    [14, 'Good afternoon, Hana'],
    [20, 'Good evening, Hana'],
  ])('greets by the hour (%i:00) and first name', (hour, greeting) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, hour, 0, 0))
    setup('head_auditor')
    mount()
    expect(screen.getByText(greeting)).toBeInTheDocument()
  })

  it('updates the greeting every minute', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 2, 10, 11, 59, 30))
    setup('auditor')
    mount()
    expect(screen.getByText('Good morning, Andy')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Good afternoon, Andy')).toBeInTheDocument()
  })

  it('greets without a name when the user is unknown', () => {
    setup(null)
    mount()
    expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
  })

  it('offers New Audit to a head auditor and Upload Guideline to an admin', () => {
    setup('head_auditor')
    const { unmount } = mount()
    expect(screen.getByRole('link', { name: /New Audit/ })).toHaveAttribute('href', '/projects/new')
    expect(screen.queryByRole('link', { name: /Upload Guideline/ })).toBeNull()
    unmount()
    setup('admin')
    const second = mount()
    expect(screen.getByRole('link', { name: /Upload Guideline/ })).toHaveAttribute('href', '/generator')
    second.unmount()
    setup('auditor')
    mount()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('opens the mobile menu', async () => {
    setup('auditor')
    const onOpenMenu = vi.fn()
    mount(onOpenMenu)
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(onOpenMenu).toHaveBeenCalledTimes(1)
  })

  it('opens the account menu with the name and role, and closes it on Escape or an outside click', async () => {
    setup('head_auditor')
    mount()
    const trigger = screen.getByRole('button', { name: 'Account menu for Hana Head' })
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu')
    expect(menu).toHaveTextContent('Hana Head')
    expect(menu).toHaveTextContent('head auditor')
    fireEvent.mouseDown(menu)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('asks before signing out, and Cancel keeps the session', async () => {
    setup('auditor')
    mount()
    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sign Out' })
    expect(dialog).toHaveTextContent('Are you sure you want to sign out of SafetyAudit?')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(useStore.getState().isAuthenticated).toBe(true)
  })

  it('signs out and goes to the sign-in page', async () => {
    setup('auditor')
    mount()
    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign Out' }))
    expect(await screen.findByText('Sign-in page')).toBeInTheDocument()
    expect(useStore.getState()).toMatchObject({ isAuthenticated: false, authToken: null, currentUserId: '' })
  })
})
