import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStore } from '../../../../../src/store/useStore'
import ProjectsPage from '../../../../../src/features/projects/pages/ProjectsPage'
import type { AuditProject, User } from '../../../../../src/types'

const initFromDb = vi.fn()

const USERS: User[] = [
  { id: 'h1', name: 'Hana Head', role: 'head_auditor', initials: 'HH', color: 'bg-violet-500' },
  { id: 'a1', name: 'Andy Auditor', role: 'auditor', initials: 'AA', color: 'bg-emerald-500' },
  { id: 'a2', name: 'Bea Auditor', role: 'auditor', initials: 'BA', color: 'bg-emerald-500' },
  { id: 'ad', name: 'Ada Admin', role: 'admin', initials: 'AD', color: 'bg-blue-600' },
]

const project = (over: Partial<AuditProject>): AuditProject => ({
  id: 'p1', name: 'TikTok audit', platform: 'TikTok', guidelineIds: ['g1'], status: 'in_progress',
  submissionStatus: 'not_submitted', headAuditorId: 'h1', auditorIds: ['h1', 'a1', 'a2'],
  createdAt: '2026-01-01', updatedAt: '2026-01-05', dueDate: '2026-12-24', scope: [], ...over,
})

const PROJECTS: AuditProject[] = [
  project({}),
  project({ id: 'p2', name: 'Instagram audit', platform: 'Instagram', status: 'completed', updatedAt: '2026-02-01', dueDate: undefined }),
  project({ id: 'p3', name: 'Draft audit', platform: 'Discord', status: 'draft', updatedAt: '2026-01-02' }),
  project({ id: 'p4', name: 'Review audit', platform: 'YouTube', status: 'under_review', updatedAt: '2026-01-03' }),
]

function setup(role: User['role'] | null, over: Record<string, unknown> = {}) {
  const me = USERS.find((u) => u.role === role)
  useStore.setState({
    currentUserId: me?.id ?? 'nobody',
    users: USERS,
    projects: PROJECTS,
    guidelines: [{ id: 'g1', name: 'EDPB', shortName: 'EDPB', version: '1', description: '', source: '', categories: [], itemCount: 3, lastUpdated: '' }],
    complianceMap: { p1: 87.5, p2: 100 },
    projectItemCounts: { p1: { answered: 2, total: 3 } },
    loading: false,
    dbError: null,
    initFromDb,
    ...over,
  } as never)
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/projects']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<p>New audit form</p>} />
        <Route path="/projects/:id" element={<p>Audit page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const rowNames = () => screen.getAllByRole('link').map((a) => a.getAttribute('href')).filter((h) => /^\/projects\/p/.test(h ?? ''))

beforeEach(() => {
  localStorage.clear()
  initFromDb.mockReset().mockResolvedValue(undefined)
})

describe('ProjectsPage', () => {
  it('loads from the database on mount and lists every project, newest first, for a head auditor', async () => {
    setup('head_auditor')
    mount()
    expect(initFromDb).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('TikTok audit')).toBeInTheDocument()
    expect(screen.getByText('4 total · 1 active')).toBeInTheDocument()
    expect(rowNames()).toEqual(['/projects/p2', '/projects/p1', '/projects/p4', '/projects/p3'])
    // Row details: compliance, progress, due date, guideline names and status.
    const row = screen.getByText('TikTok audit').closest('a') as HTMLElement
    expect(within(row).getByText('87.5%')).toBeInTheDocument()
    expect(within(row).getByText('2/3 items')).toBeInTheDocument()
    expect(within(row).getByText('24 Dec')).toBeInTheDocument()
    expect(within(row).getByText('EDPB')).toBeInTheDocument()
    expect(within(row).getByText('In Progress')).toBeInTheDocument()
    expect(within(row).getByTitle('Hana Head')).toBeInTheDocument()
    expect(within(row).getByTitle('Andy Auditor')).toBeInTheDocument()
    const noScore = screen.getByText('Draft audit').closest('a') as HTMLElement
    expect(within(noScore).getByText('n/a')).toBeInTheDocument()
    expect(within(noScore).getByText('0/0 items')).toBeInTheDocument()
  })

  it('shows the New Audit button to a head auditor only', async () => {
    setup('head_auditor')
    const { unmount } = mount()
    await userEvent.click(screen.getByRole('link', { name: /New Audit/ }))
    expect(await screen.findByText('New audit form')).toBeInTheDocument()
    unmount()
    setup('auditor')
    mount()
    expect(screen.queryByRole('link', { name: /New Audit/ })).toBeNull()
  })

  it('hides drafts and the Draft filter from an auditor', async () => {
    setup('auditor')
    mount()
    await screen.findByText('TikTok audit')
    expect(screen.queryByText('Draft audit')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Draft/ })).toBeNull()
    expect(screen.getByText('3 total · 1 active')).toBeInTheDocument()
  })

  it('blocks an admin with an access message', () => {
    setup('admin')
    mount()
    expect(screen.getByText('Access Restricted')).toBeInTheDocument()
    expect(screen.queryByText('TikTok audit')).toBeNull()
  })

  it('filters by status, with a count on each tab', async () => {
    setup('head_auditor')
    mount()
    await screen.findByText('TikTok audit')
    const completed = screen.getByRole('button', { name: /^Completed/ })
    expect(within(completed).getByText('1')).toBeInTheDocument()
    await userEvent.click(completed)
    await vi.waitFor(() => expect(screen.queryByText('TikTok audit')).toBeNull())
    expect(screen.getByText('Instagram audit')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Under Review/ }))
    expect(await screen.findByText('Review audit')).toBeInTheDocument()
  })

  it('offers to clear a filter that matches nothing', async () => {
    setup('head_auditor', { projects: [PROJECTS[0]] })
    mount()
    await screen.findByText('TikTok audit')
    await userEvent.click(screen.getByRole('button', { name: /^Draft/ }))
    expect(await screen.findByText('No audits match this filter.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(await screen.findByText('TikTok audit')).toBeInTheDocument()
  })

  it('shows skeleton rows while the first load is running', () => {
    setup('head_auditor', { projects: [], loading: true })
    const { container } = mount()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5)
    expect(screen.queryByText('No audits yet.')).toBeNull()
  })

  it('invites a head auditor to create the first audit when there are none', async () => {
    setup('head_auditor', { projects: [] })
    mount()
    expect(await screen.findByText('No audits yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create your first audit' })).toHaveAttribute('href', '/projects/new')
  })

  it('tells an auditor with no audits that they appear once assigned', async () => {
    setup('auditor', { projects: [] })
    mount()
    expect(await screen.findByText('Audits appear here once a head auditor assigns you to one.')).toBeInTheDocument()
  })

  it('shows a load error with a Retry that loads again', async () => {
    setup('head_auditor', { dbError: 'Server down' })
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load audits: Server down")
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(initFromDb).toHaveBeenCalledTimes(2)
  })

  it('opens the audit when a row is clicked', async () => {
    setup('head_auditor')
    mount()
    await userEvent.click(await screen.findByText('Review audit'))
    expect(await screen.findByText('Audit page')).toBeInTheDocument()
  })
})
