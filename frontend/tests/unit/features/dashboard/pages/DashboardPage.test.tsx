import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// An admin's dashboard is the guidelines page; that page is tested on its own.
vi.mock('../../../../../src/features/guidelines/pages/GuidelinesPage', () => ({ default: () => <p>Guidelines page</p> }))

import { useStore } from '../../../../../src/store/useStore'
import DashboardPage from '../../../../../src/features/dashboard/pages/DashboardPage'
import type { AuditProject, User } from '../../../../../src/types'

const initFromDb = vi.fn()

const USERS: User[] = [
  { id: 'h1', name: 'Hana Head', role: 'head_auditor', initials: 'HH', color: 'bg-violet-500' },
  { id: 'a1', name: 'Andy Auditor', role: 'auditor', initials: 'AA', color: 'bg-emerald-500' },
  { id: 'ad', name: 'Ada Admin', role: 'admin', initials: 'AD', color: 'bg-blue-600' },
]

const project = (over: Partial<AuditProject>): AuditProject => ({
  id: 'p1', name: 'TikTok audit', platform: 'TikTok', guidelineIds: ['g1'], status: 'in_progress',
  submissionStatus: 'not_submitted', headAuditorId: 'h1', auditorIds: ['h1', 'a1'],
  createdAt: '2026-01-01', updatedAt: '2026-03-01', scope: [], ...over,
})

// Today is fixed at 10 March 2026 (local time), so due dates are relative to it.
const PROJECTS: AuditProject[] = [
  project({ dueDate: '2026-03-13' }),
  project({ id: 'p2', name: 'Instagram audit', platform: 'Instagram', dueDate: '2026-04-30', updatedAt: '2026-03-05' }),
  project({ id: 'p3', name: 'Late audit', platform: 'Mastodon', dueDate: '2026-03-01', updatedAt: '2026-02-01' }),
  project({ id: 'p4', name: 'Today audit', platform: 'YouTube', dueDate: '2026-03-10T09:00:00Z', updatedAt: '2026-02-02' }),
  project({ id: 'p5', name: 'Done audit', status: 'completed', dueDate: '2026-01-01', updatedAt: '2026-02-03' }),
  project({ id: 'p6', name: 'Review audit', status: 'under_review', updatedAt: '2026-02-04' }),
  project({ id: 'p7', name: 'Draft audit', status: 'draft', updatedAt: '2026-02-05' }),
]

function setup(role: User['role'], over: Record<string, unknown> = {}) {
  useStore.setState({
    currentUserId: USERS.find((u) => u.role === role)!.id,
    users: USERS,
    projects: PROJECTS,
    guidelines: [{ id: 'g1', name: 'EDPB', shortName: 'EDPB', version: '1', description: '', source: '', categories: [], itemCount: 3, lastUpdated: '' }],
    complianceMap: { p1: 92 },
    loading: false,
    dbError: null,
    initFromDb,
    ...over,
  } as never)
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/projects/new" element={<p>New audit form</p>} />
        <Route path="/projects/:id" element={<p>Audit page</p>} />
        <Route path="/projects" element={<p>Audit list</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const section = (title: string) => screen.getByRole('heading', { name: title }).parentElement as HTMLElement

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  initFromDb.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DashboardPage', () => {
  it('loads from the database and summarises a head auditor\'s audits', () => {
    setup('head_auditor')
    mount()
    expect(initFromDb).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('4 audits in progress, 1 completed.')).toBeInTheDocument()
    const totals = within(screen.getByText('Total Audits').parentElement as HTMLElement)
    expect(totals.getByText('1 draft')).toBeInTheDocument()
    expect(totals.getByText('4 active')).toBeInTheDocument()
    expect(totals.getByText('1 in review')).toBeInTheDocument()
    expect(totals.getByText('1 done')).toBeInTheDocument()
    expect(screen.getByText('57% of total')).toBeInTheDocument()
    // One under review; one in-progress audit is past its date (the completed one does not count).
    expect(screen.getByText('Awaiting my review').previousElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Overdue').previousElementSibling).toHaveTextContent('1')
  })

  it('lists recent audits newest first with their score, guidelines and status', () => {
    setup('head_auditor')
    mount()
    const recent = within(section('Recent Audits').parentElement as HTMLElement)
    const names = recent.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(names).toEqual(['/projects', '/projects/p2', '/projects/p1', '/projects/p7', '/projects/p6', '/projects/p5', '/projects/p4', '/projects/p3'])
    const tiktok = recent.getByText('TikTok audit').closest('a') as HTMLElement
    expect(within(tiktok).getByText('92%')).toBeInTheDocument()
    expect(within(tiktok).getByText('EDPB')).toBeInTheDocument()
    expect(within(tiktok).getByText('TK')).toBeInTheDocument()
    expect(within(tiktok).getByTitle('Andy Auditor')).toBeInTheDocument()
    const other = recent.getByText('Late audit').closest('a') as HTMLElement
    expect(within(other).getByText('n/a')).toBeInTheDocument()
    expect(within(other).getByText('MA')).toBeInTheDocument()
  })

  it('shows the three nearest deadlines with days left, today and overdue', () => {
    setup('head_auditor')
    mount()
    const deadlines = within(section('Upcoming Deadlines'))
    const rows = deadlines.getAllByRole('link')
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/projects/p3', '/projects/p4', '/projects/p1'])
    expect(within(rows[0]).getByText('overdue')).toBeInTheDocument()
    expect(within(rows[1]).getByText('today')).toBeInTheDocument()
    expect(within(rows[2]).getByText('3d')).toBeInTheDocument()
    expect(within(rows[2]).getByText('13 Mar')).toBeInTheDocument()
  })

  it('shows the team with active audit counts to a head auditor only', () => {
    setup('head_auditor')
    const { unmount } = mount()
    const team = within(section('Team'))
    expect(team.getByText('Andy Auditor')).toBeInTheDocument()
    expect(team.queryByText('Ada Admin')).toBeNull()
    const andy = team.getByText('Andy Auditor').closest('div.flex') as HTMLElement
    expect(within(andy).getByText('4 active')).toBeInTheDocument()
    unmount()
    setup('auditor')
    mount()
    expect(screen.queryByRole('heading', { name: 'Team' })).toBeNull()
  })

  it('hides drafts from an auditor and labels the review count for them', () => {
    setup('auditor')
    mount()
    expect(screen.queryByText('Draft audit')).toBeNull()
    expect(screen.queryByText('1 draft')).toBeNull()
    expect(screen.getByText('Awaiting review')).toBeInTheDocument()
    expect(screen.getByText('67% of total')).toBeInTheDocument()
  })

  it('shows the guidelines page to an admin', () => {
    setup('admin')
    mount()
    expect(screen.getByText('Guidelines page')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull()
  })

  it('shows a skeleton while the first load is running', () => {
    setup('head_auditor', { projects: [], loading: true })
    const { container } = mount()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull()
  })

  it('shows empty states, and a create link for a head auditor, when there are no audits', async () => {
    setup('head_auditor', { projects: [] })
    mount()
    expect(screen.getByText('0 audits in progress.')).toBeInTheDocument()
    expect(screen.getAllByText('No audits yet')).toHaveLength(2)
    expect(screen.getByText('No audits yet.')).toBeInTheDocument()
    expect(screen.getByText('No upcoming deadlines.')).toBeInTheDocument()
    vi.useRealTimers()
    await userEvent.click(screen.getByRole('link', { name: 'Create your first audit' }))
    expect(await screen.findByText('New audit form')).toBeInTheDocument()
  })

  it('does not offer to create an audit to an auditor with none', () => {
    setup('auditor', { projects: [] })
    mount()
    expect(screen.getByText('No audits yet.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create your first audit' })).toBeNull()
  })

  it('uses the singular for one audit in progress', () => {
    setup('head_auditor', { projects: [project({ dueDate: '2026-06-01' })] })
    mount()
    expect(screen.getByText('1 audit in progress.')).toBeInTheDocument()
    const deadlines = within(section('Upcoming Deadlines'))
    expect(deadlines.getByText('83d')).toBeInTheDocument()
  })

  it('shows a load error with a Retry that loads again', async () => {
    setup('head_auditor', { dbError: 'Server down' })
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your audits: Server down")
    vi.useRealTimers()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(initFromDb).toHaveBeenCalledTimes(2)
  })
})
