import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../src/lib/db', async (orig) => ({
  ...(await orig<typeof import('../../../../../src/lib/db')>()),
  createProject: vi.fn(),
  syncProjectMembers: vi.fn(),
  syncProjectGuidelines: vi.fn(),
  fetchUserProjects: vi.fn(),
}))

// The store first: lib/db imports the store, so loading the store first gives it the mocked lib/db.
import { useStore } from '../../../../../src/store/useStore'
import * as db from '../../../../../src/lib/db'
import CreateProjectPage from '../../../../../src/features/projects/pages/CreateProjectPage'
import type { Guideline, User } from '../../../../../src/types'

const USERS: User[] = [
  { id: 'h1', name: 'Hana Head', role: 'head_auditor', initials: 'HH', color: 'bg-violet-500' },
  { id: 'a1', name: 'Andy Auditor', role: 'auditor', initials: 'AA', color: 'bg-emerald-500' },
  { id: 'a2', name: 'Bea Auditor', role: 'auditor', initials: 'BA', color: 'bg-emerald-500' },
  { id: 'h2', name: 'Other Head', role: 'head_auditor', initials: 'OH', color: 'bg-violet-500' },
]
const guideline = (over: Partial<Guideline>): Guideline => ({
  id: 'g1', name: 'EDPB Guidelines', shortName: 'EDPB', version: '2', description: 'Data protection', source: '',
  categories: ['Consent > Parental', 'Consent > Age', 'Design'], itemCount: 10, lastUpdated: '', ...over,
})
const GUIDELINES = [
  guideline({}),
  guideline({ id: 'g2', name: 'UK Children Code', shortName: 'AADC', itemCount: 5, categories: [] }),
  guideline({ id: 'g3', name: 'Deleted one', shortName: 'DEL', isDeleted: true }),
  guideline({ id: 'g4', name: 'Project copy', shortName: 'COPY', projectId: 'p9' }),
]

function setup(role: User['role'] = 'head_auditor', over: Record<string, unknown> = {}) {
  useStore.setState({
    currentUserId: role === 'head_auditor' ? 'h1' : 'a1',
    users: USERS,
    guidelines: GUIDELINES,
    projects: [],
    loading: false,
    ...over,
  } as never)
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/projects/new']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/projects/new" element={<CreateProjectPage />} />
        <Route path="/projects/:id" element={<p>Audit page</p>} />
        <Route path="/projects" element={<p>Audit list</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const submit = () => user.click(screen.getByRole('button', { name: /Create Audit Project/ }))
const summaryValue = (label: string) => (screen.getByText(label, { selector: 'span' }).nextElementSibling as HTMLElement)

// One user per test; typing does not wait between keys, which keeps the long forms fast.
let user: UserEvent

beforeEach(() => {
  user = userEvent.setup({ delay: null })
  localStorage.clear()
  vi.mocked(db.createProject).mockReset().mockResolvedValue('new-id')
  vi.mocked(db.syncProjectMembers).mockReset().mockResolvedValue(undefined)
  vi.mocked(db.syncProjectGuidelines).mockReset().mockResolvedValue(undefined)
  vi.mocked(db.fetchUserProjects).mockReset().mockResolvedValue([])
})

describe('CreateProjectPage access', () => {
  it.each(['auditor', 'admin'] as const)('blocks a %s with an access message', (role) => {
    setup(role, role === 'admin' ? { currentUserId: 'ad', users: [...USERS, { id: 'ad', name: 'Ad', role: 'admin', initials: 'A', color: '' }] } : {})
    mount()
    expect(screen.getByText('Access Restricted')).toBeInTheDocument()
    expect(screen.getByText('Only Head Auditors can create new audit projects.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create Audit Project/ })).toBeNull()
  })
})

describe('CreateProjectPage form', () => {
  it('lists only live, global guidelines with their sections and item counts', () => {
    setup()
    mount()
    expect(screen.getByRole('button', { name: /EDPB Guidelines/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /UK Children Code/ })).toBeInTheDocument()
    expect(screen.queryByText('Deleted one')).toBeNull()
    expect(screen.queryByText('Project copy')).toBeNull()
    const edpb = screen.getByRole('button', { name: /EDPB Guidelines/ })
    // Sections are the first part of each category, once each.
    expect(within(edpb).getByText('Consent')).toBeInTheDocument()
    expect(within(edpb).getByText('Design')).toBeInTheDocument()
    expect(within(edpb).getByText('v2')).toBeInTheDocument()
  })

  it('shows every validation message and focuses the name field when nothing is filled in', async () => {
    setup()
    mount()
    await submit()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Fix 3 items before creating')
    expect(alert).toHaveTextContent('Project name: Enter a project name.')
    expect(alert).toHaveTextContent('Platform: Select a platform to audit.')
    expect(alert).toHaveTextContent('Guidelines: Select at least one guideline.')
    expect(screen.getByLabelText(/Project Name/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/Project Name/)).toHaveFocus()
    expect(db.createProject).not.toHaveBeenCalled()
  })

  it('clears each message as its field is fixed', async () => {
    setup()
    mount()
    await submit()
    await user.type(screen.getByLabelText(/Project Name/), 'My audit')
    expect(screen.getByRole('alert')).toHaveTextContent('Fix 2 items before creating')
    await user.click(screen.getByRole('button', { name: /TikTok/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Fix 1 item before creating')
    await user.click(screen.getByRole('button', { name: /EDPB Guidelines/ }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('asks for the platform name when Other is picked and left blank', async () => {
    setup()
    mount()
    await user.type(screen.getByLabelText(/Project Name/), 'My audit')
    await user.click(screen.getByRole('button', { name: /EDPB Guidelines/ }))
    await user.click(screen.getByRole('button', { name: /Other/ }))
    expect(screen.getByRole('button', { name: /Other/ })).toHaveAttribute('aria-pressed', 'true')
    await submit()
    expect(screen.getByRole('alert')).toHaveTextContent('Platform: Enter the platform name.')
    await user.type(screen.getByLabelText('Custom platform name'), 'LinkedIn')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('LinkedIn selected')).toBeInTheDocument()
  })

  it('creates the project with the trimmed name, platform, guidelines, team, due date and notes, then opens it', async () => {
    setup()
    mount()
    await user.type(screen.getByLabelText(/Project Name/), '  Spring audit  ')
    await user.click(screen.getByRole('button', { name: /Instagram/ }))
    await user.click(screen.getByRole('button', { name: /EDPB Guidelines/ }))
    await user.click(screen.getByRole('button', { name: /UK Children Code/ }))
    expect(screen.getByText('2 selected · 15 items')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Bea Auditor/ }))
    await user.type(screen.getByLabelText(/Notes/), 'Focus on teens')
    await user.type(screen.getByLabelText(/Due Date/), '2030-03-15')

    expect(summaryValue('Name')).toHaveTextContent('Spring audit')
    expect(summaryValue('Platform')).toHaveTextContent('Instagram')
    expect(summaryValue('Guidelines')).toHaveTextContent('2 selected')
    expect(summaryValue('Checklist items')).toHaveTextContent('15')
    expect(summaryValue('Auditors')).toHaveTextContent('2')
    expect(summaryValue('Due date')).toHaveTextContent('15 Mar 2030')

    await submit()
    expect(await screen.findByText('Audit page')).toBeInTheDocument()
    expect(db.createProject).toHaveBeenCalledWith({
      title: 'Spring audit', platform: 'Instagram', headAuditorId: 'h1', notes: 'Focus on teens', dueDate: '2030-03-15', status: 'in_progress',
    })
    expect(db.syncProjectMembers).toHaveBeenCalledWith('new-id', ['h1', 'a2'])
    expect(db.syncProjectGuidelines).toHaveBeenCalledWith('new-id', ['g1', 'g2'])
  })

  it('sends the typed platform for Other and no due date when none is set', async () => {
    setup()
    mount()
    await user.type(screen.getByLabelText(/Project Name/), 'LI audit')
    await user.click(screen.getByRole('button', { name: /Other/ }))
    await user.type(screen.getByLabelText('Custom platform name'), ' LinkedIn ')
    await user.click(screen.getByRole('button', { name: /UK Children Code/ }))
    await submit()
    await screen.findByText('Audit page')
    expect(db.createProject).toHaveBeenCalledWith(expect.objectContaining({ platform: 'LinkedIn', dueDate: undefined, notes: '' }))
    expect(db.syncProjectMembers).toHaveBeenCalledWith('new-id', ['h1'])
  })

  it('shows the server error and stays on the form when creating fails', async () => {
    vi.mocked(db.createProject).mockRejectedValue(new Error('Title taken'))
    setup()
    mount()
    await user.type(screen.getByLabelText(/Project Name/), 'X')
    await user.click(screen.getByRole('button', { name: /TikTok/ }))
    await user.click(screen.getByRole('button', { name: /EDPB Guidelines/ }))
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create this audit project: Title taken")
    expect(screen.getByRole('button', { name: /Create Audit Project/ })).toBeEnabled()
    expect(screen.queryByText('Audit page')).toBeNull()
  })

  it('shows a connection message for a non-Error failure', async () => {
    vi.mocked(db.createProject).mockRejectedValue('offline')
    setup()
    mount()
    await user.type(screen.getByLabelText(/Project Name/), 'X')
    await user.click(screen.getByRole('button', { name: /TikTok/ }))
    await user.click(screen.getByRole('button', { name: /EDPB Guidelines/ }))
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create this audit project. Check your connection and try again.")
  })

  it('disables the button and ignores a second submit while creating', async () => {
    let finish!: (id: string) => void
    vi.mocked(db.createProject).mockReturnValue(new Promise((r) => { finish = r }))
    setup()
    mount()
    await user.type(screen.getByLabelText(/Project Name/), 'X')
    await user.click(screen.getByRole('button', { name: /TikTok/ }))
    await user.click(screen.getByRole('button', { name: /EDPB Guidelines/ }))
    await submit()
    const busy = await screen.findByRole('button', { name: /Creating/ })
    expect(busy).toBeDisabled()
    // Enter in a field submits the form even though the button is disabled.
    fireEvent.submit(busy.closest('form') as HTMLFormElement)
    finish('new-id')
    await screen.findByText('Audit page')
    expect(db.createProject).toHaveBeenCalledTimes(1)
  })

  it('unselects a guideline on a second click', async () => {
    setup()
    mount()
    const edpb = screen.getByRole('button', { name: /EDPB Guidelines/ })
    await user.click(edpb)
    expect(edpb).toHaveAttribute('aria-pressed', 'true')
    await user.click(edpb)
    expect(edpb).toHaveAttribute('aria-pressed', 'false')
    expect(summaryValue('Guidelines')).toHaveTextContent('None')
  })
})

describe('CreateProjectPage team picker', () => {
  it('lists other auditors only, filters by name, and adds and removes members', async () => {
    setup()
    mount()
    const search = screen.getByLabelText('Search auditors to add')
    // Head auditors (the current one and another) are not offered.
    expect(screen.queryByRole('button', { name: /Other Head/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Andy Auditor/ })).toBeInTheDocument()
    await user.type(search, 'bea')
    expect(screen.queryByRole('button', { name: /Andy Auditor/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: /Bea Auditor/ }))
    expect(search).toHaveValue('')
    expect(screen.getByText('2 members')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Bea Auditor' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Bea Auditor' }))
    expect(screen.getByText('1 member')).toBeInTheDocument()
  })

  it('says when no auditor matches, and the clear button empties the search', async () => {
    setup()
    mount()
    await user.type(screen.getByLabelText('Search auditors to add'), 'zzz')
    expect(screen.getByText('No auditors match that name.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear auditor search' }))
    expect(screen.getByLabelText('Search auditors to add')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Andy Auditor/ })).toBeInTheDocument()
  })

  it('says when every auditor has been added', async () => {
    setup()
    mount()
    await user.click(screen.getByRole('button', { name: /Andy Auditor/ }))
    await user.click(screen.getByRole('button', { name: /Bea Auditor/ }))
    expect(screen.getByText('All auditors have been added.')).toBeInTheDocument()
  })
})

describe('CreateProjectPage loading and empty states', () => {
  it('shows loading text for frameworks and auditors while the store loads', () => {
    setup('head_auditor', { guidelines: [], loading: true, users: [USERS[0]] })
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('Loading frameworks…')
    expect(screen.getByText('Loading auditors…')).toBeInTheDocument()
  })

  it('explains that an admin must add a framework when there are none', async () => {
    setup('head_auditor', { guidelines: [] })
    mount()
    expect(screen.getByText('No guideline frameworks available yet.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
})
