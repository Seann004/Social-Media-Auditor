import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The shell subscribes to Supabase realtime; that hook is tested on its own.
vi.mock('../../src/hooks/useRealtimeGuidelines', () => ({ useRealtimeGuidelines: vi.fn() }))
// The generator page loads the PDF reader, which needs browser APIs jsdom lacks.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.js' }))

import { useStore } from '../../src/store/useStore'
import App from '../../src/App'

const initFromDb = vi.fn()

function visit(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => {
  localStorage.clear()
  initFromDb.mockReset().mockResolvedValue(undefined)
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })) as never
  useStore.setState({ isAuthenticated: false, currentUserId: '', users: [], projects: [], initFromDb } as never)
})

afterEach(() => {
  // @ts-expect-error jsdom has no matchMedia of its own
  delete window.matchMedia
  window.history.pushState({}, '', '/')
})

describe('App routes', () => {
  it('shows the sign-in page at the root', () => {
    visit('/')
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows the registration page', () => {
    visit('/register')
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument()
  })

  it('sends a signed-out visitor from a protected page to sign in', () => {
    visit('/projects')
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
  })

  it('sends an unknown address to sign in', () => {
    visit('/no-such-page')
    expect(window.location.pathname).toBe('/')
  })

  it('opens the audits list inside the shell for a signed-in auditor', async () => {
    useStore.setState({
      isAuthenticated: true, currentUserId: 'a1',
      users: [{ id: 'a1', name: 'Andy Auditor', role: 'auditor', initials: 'AA', color: '' }],
    } as never)
    visit('/projects')
    expect(await screen.findByRole('heading', { name: 'Audit Projects' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('keeps an auditor out of the admin generator', async () => {
    useStore.setState({
      isAuthenticated: true, currentUserId: 'a1',
      users: [{ id: 'a1', name: 'Andy Auditor', role: 'auditor', initials: 'AA', color: '' }],
    } as never)
    visit('/generator')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/dashboard')
  })
})
