import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { EvidenceApiError } from '../api'
import { useStore } from '../../../store/useStore'
import { makeRun, makeSuggestion } from '../testFixtures'
import { useEvidence } from '../useEvidence'
import type { ChecklistItem } from '../../../types'
import EvidencePanel from './EvidencePanel'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    getSources: vi.fn(),
    getLatestRun: vi.fn(),
    getSuggestions: vi.fn(),
    getAppSetup: vi.fn(),
    getRepoSource: vi.fn(),
    saveRepoSource: vi.fn(),
    startRepoRun: vi.fn(),
    reassess: vi.fn(),
  }
})

const m = {
  getSources: vi.mocked(api.getSources),
  getLatestRun: vi.mocked(api.getLatestRun),
  getSuggestions: vi.mocked(api.getSuggestions),
  getAppSetup: vi.mocked(api.getAppSetup),
  getRepoSource: vi.mocked(api.getRepoSource),
  saveRepoSource: vi.mocked(api.saveRepoSource),
  startRepoRun: vi.mocked(api.startRepoRun),
  reassess: vi.mocked(api.reassess),
}

const item = (n: number, category = 'Privacy'): ChecklistItem => ({
  id: `i${n}`,
  guidelineId: 'g1',
  category,
  text: `Text ${n}`,
  itemName: `Item ${n}`,
  severity: 'high',
})
const items = [...Array.from({ length: 8 }, (_, i) => item(i + 1)), ...Array.from({ length: 4 }, (_, i) => item(i + 9, 'Safety'))]
const repo = { repoUrl: 'https://github.com/o/n', branch: null, updatedAt: '2026-11-07T09:00:00.000Z' }

function Harness() {
  const evidence = useEvidence('p1', { enabled: true })
  return <EvidencePanel projectId="p1" role="auditor" evidence={evidence} locked={false} checklistItems={items} />
}

beforeEach(() => {
  useStore.setState({ sessionToken: null })
  Object.values(m).forEach((fn) => fn.mockReset())
  m.getSources.mockResolvedValue({ source: null, permission: null })
  m.getLatestRun.mockResolvedValue({ run: null, pages: [] })
  m.getSuggestions.mockResolvedValue({ run: null, suggestions: [], decisions: [] })
  m.getAppSetup.mockResolvedValue({ app: null, accounts: [], secretKeyConfigured: true })
  m.getRepoSource.mockResolvedValue({ repo: null })
})

async function openRepo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: 'Code repository' }))
  await screen.findByLabelText('Repository address')
}

describe('Code repository source in the evidence panel', () => {
  it('shows the form with its exact texts', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openRepo(user)
    expect(screen.getByLabelText('Repository address')).toHaveAttribute('placeholder', 'https://github.com/owner/name')
    expect(screen.getByLabelText('Branch (optional)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save repository' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check the code' })).toBeDisabled()
    expect(screen.getByText('Only public GitHub repositories. The code is read, never run.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/website links/i)).not.toBeInTheDocument()
  })

  it('saves the repository and shows the saved address', async () => {
    const user = userEvent.setup()
    m.saveRepoSource.mockResolvedValue({ repo: { ...repo, branch: 'dev' } })
    render(<Harness />)
    await openRepo(user)
    await user.type(screen.getByLabelText('Repository address'), repo.repoUrl)
    await user.type(screen.getByLabelText('Branch (optional)'), 'dev')
    await user.click(screen.getByRole('button', { name: 'Save repository' }))
    expect(m.saveRepoSource).toHaveBeenCalledWith('p1', { repoUrl: repo.repoUrl, branch: 'dev' })
    expect(await screen.findByText(repo.repoUrl, { selector: 'span' })).toBeInTheDocument()
  })

  it('sends a blank branch as null and shows a refusal sentence under the field', async () => {
    const user = userEvent.setup()
    m.saveRepoSource.mockRejectedValue(new EvidenceApiError(400, 'Enter a public GitHub repository address, like https://github.com/owner/name.'))
    render(<Harness />)
    await openRepo(user)
    await user.type(screen.getByLabelText('Repository address'), 'nope')
    await user.click(screen.getByRole('button', { name: 'Save repository' }))
    expect(m.saveRepoSource).toHaveBeenCalledWith('p1', { repoUrl: 'nope', branch: null })
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a public GitHub repository address, like https://github.com/owner/name.')
  })

  it('links the error and the hint to the address field', async () => {
    const user = userEvent.setup()
    m.saveRepoSource.mockRejectedValue(new EvidenceApiError(400, 'Nope.'))
    render(<Harness />)
    await openRepo(user)
    const input = screen.getByLabelText('Repository address')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).toHaveAccessibleDescription('Only public GitHub repositories. The code is read, never run.')
    await user.click(screen.getByRole('button', { name: 'Save repository' }))
    await screen.findByRole('alert')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Nope. Only public GitHub repositories. The code is read, never run.')
  })

  it('says "Something went wrong. Try again." when saving fails without a server reply', async () => {
    const user = userEvent.setup()
    m.saveRepoSource.mockRejectedValue(new Error('boom'))
    render(<Harness />)
    await openRepo(user)
    await user.type(screen.getByLabelText('Repository address'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save repository' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.')
  })

  it('says "Something went wrong. Try again." when starting fails without a server reply', async () => {
    const user = userEvent.setup()
    m.getRepoSource.mockResolvedValue({ repo })
    m.startRepoRun.mockRejectedValue(new Error('boom'))
    render(<Harness />)
    await openRepo(user)
    await screen.findByText(repo.repoUrl, { selector: 'span' })
    await user.click(screen.getByRole('checkbox', { name: 'Item 1' }))
    await user.click(screen.getByRole('button', { name: 'Check the code' }))
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument()
  })

  it('caps the picker at 10 with the same style of message as the app', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openRepo(user)
    for (let n = 1; n <= 10; n += 1) await user.click(screen.getByRole('checkbox', { name: `Item ${n}` }))
    expect(screen.getByText('Up to 10 items per repository run.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Item 11' })).toBeDisabled()
  })

  it('Check the code sends the picked ids in checklist order', async () => {
    const user = userEvent.setup()
    m.getRepoSource.mockResolvedValue({ repo })
    m.startRepoRun.mockResolvedValue({ run: makeRun({ source: 'repo', status: 'queued' }) })
    render(<Harness />)
    await openRepo(user)
    await screen.findByText(repo.repoUrl, { selector: 'span' })
    await user.click(screen.getByRole('checkbox', { name: 'Item 9' }))
    await user.click(screen.getByRole('checkbox', { name: 'Item 2' }))
    await user.click(screen.getByRole('button', { name: 'Check the code' }))
    expect(m.startRepoRun).toHaveBeenCalledWith('p1', ['i2', 'i9'])
  })

  it('shows a start refusal sentence', async () => {
    const user = userEvent.setup()
    m.getRepoSource.mockResolvedValue({ repo })
    m.startRepoRun.mockRejectedValue(new EvidenceApiError(429, 'Too many runs today.'))
    render(<Harness />)
    await openRepo(user)
    await screen.findByText(repo.repoUrl, { selector: 'span' })
    await user.click(screen.getByRole('checkbox', { name: 'Item 1' }))
    await user.click(screen.getByRole('button', { name: 'Check the code' }))
    expect(await screen.findByText('Too many runs today.')).toBeInTheDocument()
  })

  it('progress names the current item, and says "Reading the code" while capturing', async () => {
    m.getLatestRun.mockResolvedValue({
      run: makeRun({ source: 'repo', status: 'assessing', finishedAt: null, currentItemId: 'i2', categoriesDone: 1, categoriesTotal: 3 }),
      pages: [],
    })
    const view = render(<Harness />)
    expect(await screen.findByText('Checking the code: Item 2')).toBeInTheDocument()
    expect(screen.getByText('Items checked: 1 of 3')).toBeInTheDocument()
    view.unmount()
    m.getLatestRun.mockResolvedValue({ run: makeRun({ source: 'repo', status: 'capturing', finishedAt: null }), pages: [] })
    render(<Harness />)
    expect(await screen.findByText('Reading the code')).toBeInTheDocument()
  })

  it('defaults to the repo for a repo result run, summarises it by item and re-assesses by item', async () => {
    const user = userEvent.setup()
    const run = makeRun({ source: 'repo', status: 'partial', checkedItemIds: ['i1'], uncheckedItemIds: ['i3'] })
    m.getLatestRun.mockResolvedValue({ run, pages: [] })
    m.getSuggestions.mockResolvedValue({ run, suggestions: [makeSuggestion({ source: 'repo' })], decisions: [] })
    m.reassess.mockResolvedValue({ run })
    render(<Harness />)
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Code repository' })).toBeChecked())
    expect(await screen.findByText('Not checked: Item 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Re-assess unfinished items' }))
    expect(m.reassess).toHaveBeenCalledWith('p1', 'run-1', 'unfinished')
  })

  it('App and Public pages still show their own panels', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openRepo(user)
    await user.click(screen.getByRole('radio', { name: /public pages/i }))
    expect(await screen.findByLabelText(/website links/i)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /app \(test accounts\)/i }))
    expect(await screen.findByLabelText(/app address/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Repository address')).not.toBeInTheDocument()
  })
})
