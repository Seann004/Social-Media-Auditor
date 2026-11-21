import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { useStore } from '../../../src/store/useStore'
import ProtectedRoute from '../../../src/layouts/ProtectedRoute'
import RoleRoute from '../../../src/layouts/RoleRoute'
import type { UserRole } from '../../../src/types'

function signIn(role: UserRole | null, isAuthenticated = true) {
  useStore.setState({
    isAuthenticated,
    currentUserId: 'u1',
    users: role ? [{ id: 'u1', name: 'U One', role, initials: 'UO', color: '' }] : [],
  } as never)
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<p>Sign-in page</p>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<p>Dashboard page</p>} />
          <Route element={<RoleRoute allowedRoles={['admin']} />}>
            <Route path="/generator" element={<p>Generator page</p>} />
          </Route>
          <Route element={<RoleRoute allowedRoles={['head_auditor', 'auditor']} />}>
            <Route path="/projects" element={<p>Projects page</p>} />
          </Route>
        </Route>
        {/* A role route outside the protected one still checks the session itself. */}
        <Route element={<RoleRoute allowedRoles={['auditor']} />}>
          <Route path="/open" element={<p>Open page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => localStorage.clear())

describe('ProtectedRoute', () => {
  it('shows the page to a signed-in user', () => {
    signIn('auditor')
    mount('/dashboard')
    expect(screen.getByText('Dashboard page')).toBeInTheDocument()
  })

  it('sends a signed-out user to the sign-in page', () => {
    signIn('auditor', false)
    mount('/dashboard')
    expect(screen.getByText('Sign-in page')).toBeInTheDocument()
  })
})

describe('RoleRoute', () => {
  it.each([
    ['admin', '/generator', 'Generator page'],
    ['head_auditor', '/projects', 'Projects page'],
    ['auditor', '/projects', 'Projects page'],
  ] as const)('lets a %s open %s', (role, path, text) => {
    signIn(role)
    mount(path)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it.each([
    ['auditor', '/generator'],
    ['head_auditor', '/generator'],
    ['admin', '/projects'],
  ] as const)('sends a %s away from %s to the dashboard', (role, path) => {
    signIn(role)
    mount(path)
    expect(screen.getByText('Dashboard page')).toBeInTheDocument()
  })

  it('sends a signed-in user whose profile is not loaded to the dashboard', () => {
    signIn(null)
    mount('/projects')
    expect(screen.getByText('Dashboard page')).toBeInTheDocument()
  })

  it('sends a signed-out user to the sign-in page', () => {
    signIn('auditor', false)
    mount('/open')
    expect(screen.getByText('Sign-in page')).toBeInTheDocument()
  })
})
