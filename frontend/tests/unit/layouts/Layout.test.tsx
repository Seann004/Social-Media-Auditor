import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { useRealtimeGuidelines } = vi.hoisted(() => ({ useRealtimeGuidelines: vi.fn() }))
vi.mock('../../../src/hooks/useRealtimeGuidelines', () => ({ useRealtimeGuidelines }))

import { useStore } from '../../../src/store/useStore'
import Layout from '../../../src/layouts/Layout'

const initFromDb = vi.fn()

/** A controllable matchMedia: jsdom has none. */
function mockMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  // framer-motion asks about reduced motion through the older listener API.
  const other = { matches: false, addListener: () => {}, removeListener: () => {} }
  window.matchMedia = vi.fn((query: string) => (query === '(min-width: 1024px)' ? media : other)) as never
  return {
    set(next: boolean) {
      media.matches = next
      act(() => listeners.forEach((fn) => fn()))
    },
    listeners,
  }
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<p>Page content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const drawer = () => screen.getByRole('complementary').parentElement as HTMLElement

beforeEach(() => {
  localStorage.clear()
  initFromDb.mockReset().mockResolvedValue(undefined)
  useRealtimeGuidelines.mockReset()
  useStore.setState({
    isAuthenticated: true, currentUserId: 'h1', sidebarCollapsed: false, projects: [], initFromDb,
    users: [{ id: 'h1', name: 'Hana Head', role: 'head_auditor', initials: 'HH', color: '' }],
  } as never)
})

afterEach(() => {
  // @ts-expect-error jsdom has no matchMedia of its own
  delete window.matchMedia
})

describe('Layout', () => {
  it('renders the page inside the shell, loads data once and subscribes to new guidelines', () => {
    mockMedia(true)
    mount()
    expect(screen.getByText('Page content')).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(initFromDb).toHaveBeenCalledTimes(1)
    expect(useRealtimeGuidelines).toHaveBeenCalled()
  })

  it('on desktop, collapses the sidebar from its button and with Ctrl+B', async () => {
    mockMedia(true)
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(useStore.getState().sidebarCollapsed).toBe(true)
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(useStore.getState().sidebarCollapsed).toBe(false)
    fireEvent.keyDown(window, { key: 'B', metaKey: true })
    expect(useStore.getState().sidebarCollapsed).toBe(true)
  })

  it('ignores Ctrl+B while typing, and other keys', () => {
    mockMedia(true)
    mount()
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'b' })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(useStore.getState().sidebarCollapsed).toBe(false)
    input.remove()
  })

  it('on mobile, opens the drawer from the menu button and closes it from the backdrop', async () => {
    mockMedia(false)
    const { container } = mount()
    expect(drawer().className).toContain('-translate-x-full')
    // The mobile sidebar has a close button instead of a collapse button.
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(drawer().className).toContain('translate-x-0')
    await userEvent.click(container.querySelector('.bg-black\\/50') as HTMLElement)
    expect(drawer().className).toContain('-translate-x-full')
  })

  it('on mobile, closes the drawer from its close button', async () => {
    mockMedia(false)
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(drawer().className).toContain('-translate-x-full')
  })

  it('closes the drawer and shows the desktop sidebar when the window grows', async () => {
    const media = mockMedia(false)
    const { unmount } = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    media.set(true)
    await waitFor(() => expect(drawer().className).toContain('-translate-x-full'))
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
    unmount()
    expect(media.listeners.size).toBe(0)
  })
})
