import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStore } from '../../../src/store/useStore'
import Sidebar from '../../../src/layouts/Sidebar'
import type { AuditProject, User } from '../../../src/types'

const USERS: User[] = [
  { id: 'h1', name: 'Hana Head', role: 'head_auditor', initials: 'HH', color: '' },
  { id: 'a1', name: 'Andy Auditor', role: 'auditor', initials: 'AA', color: '' },
  { id: 'ad', name: 'Ada Admin', role: 'admin', initials: 'AD', color: '' },
]
const project = (over: Partial<AuditProject>): AuditProject => ({
  id: 'p1', name: 'TikTok audit', platform: 'TikTok', guidelineIds: [], status: 'in_progress', submissionStatus: 'not_submitted',
  headAuditorId: 'h1', auditorIds: [], createdAt: '', updatedAt: '', scope: [], ...over,
})
const PROJECTS = [
  project({ id: 'p1', name: 'Later audit', dueDate: '2026-09-30' }),
  project({ id: 'p2', name: 'Sooner audit', status: 'under_review', dueDate: '2026-05-02T00:00:00Z' }),
  project({ id: 'p3', name: 'Done audit', status: 'completed', dueDate: '2026-01-01' }),
  project({ id: 'p4', name: 'No date audit' }),
]

function setup(role: User['role'], projects: AuditProject[] = PROJECTS) {
  useStore.setState({ currentUserId: USERS.find((u) => u.role === role)!.id, users: USERS, projects } as never)
}

function mount(props: Partial<Parameters<typeof Sidebar>[0]> = {}, path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Sidebar collapsed={false} {...props} />
    </MemoryRouter>,
  )
}

const navLabels = () => within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link').map((a) => a.textContent)

beforeEach(() => localStorage.clear())

describe('Sidebar', () => {
  it('gives a head auditor the workspace pages and the guidelines', () => {
    setup('head_auditor')
    mount()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.getByText('Frameworks')).toBeInTheDocument()
    expect(navLabels().slice(0, 4)).toEqual(['Dashboard', 'Audits', 'Reports', 'Guidelines'])
  })

  it('gives an auditor the workspace pages only', () => {
    setup('auditor')
    mount()
    expect(navLabels().slice(0, 3)).toEqual(['Dashboard', 'Audits', 'Reports'])
    expect(screen.queryByText('Guidelines')).toBeNull()
    expect(screen.queryByText('Generator')).toBeNull()
  })

  it('gives an admin the dashboard and the generator, and no deadline card', () => {
    setup('admin')
    mount()
    expect(navLabels()).toEqual(['Dashboard', 'Generator'])
    expect(screen.queryByText('Next deadline')).toBeNull()
  })

  it('highlights the current page, including its sub-pages', () => {
    setup('head_auditor')
    mount({}, '/projects/p1')
    expect(screen.getByRole('link', { name: /Audits/ }).className).toContain('bg-white')
    expect(screen.getByRole('link', { name: /^Dashboard/ }).className).not.toContain('bg-white')
  })

  it('shows the nearest deadline of an open audit', () => {
    setup('auditor')
    mount()
    const card = screen.getByText('Next deadline').closest('a') as HTMLElement
    expect(card).toHaveAttribute('href', '/projects/p2')
    expect(within(card).getByText('Sooner audit')).toBeInTheDocument()
    expect(within(card).getByText('Due 2 May')).toBeInTheDocument()
  })

  it('shows no deadline card when no open audit has a date', () => {
    setup('auditor', [PROJECTS[2], PROJECTS[3]])
    mount()
    expect(screen.queryByText('Next deadline')).toBeNull()
  })

  it('collapsed: hides the labels, names the links, and keeps the deadline as an icon', () => {
    setup('head_auditor')
    mount({ collapsed: true, onToggle: vi.fn() })
    expect(screen.queryByText('SafetyAudit')).toBeNull()
    expect(screen.queryByText('Workspace')).toBeNull()
    expect(screen.getByRole('link', { name: 'Audits' })).toHaveAttribute('title', 'Audits')
    expect(screen.getByRole('link', { name: 'Next deadline: Sooner audit, due 2 May' })).toHaveAttribute('href', '/projects/p2')
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('calls onToggle from the collapse button', async () => {
    setup('head_auditor')
    const onToggle = vi.fn()
    mount({ onToggle })
    const button = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('in the mobile drawer, closes from the close button and from a link', async () => {
    setup('head_auditor')
    const onClose = vi.fn()
    mount({ onClose })
    expect(screen.queryByRole('button', { name: /sidebar/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    await userEvent.click(screen.getByRole('link', { name: /Reports/ }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
