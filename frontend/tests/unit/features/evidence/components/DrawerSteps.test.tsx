import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../../../../src/features/evidence/api'
import { useStore } from '../../../../../src/store/useStore'
import type { AppSetupResponse, TestAccountView } from '../../../../../src/features/evidence/types'
import { useEvidence } from '../../../../../src/features/evidence/useEvidence'
import type { ChecklistItem } from '../../../../../src/types'
import AppSetup from '../../../../../src/features/evidence/components/AppSetup'
import EvidencePanel from '../../../../../src/features/evidence/components/EvidencePanel'

vi.mock('../../../../../src/features/evidence/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/features/evidence/api')>()
  return {
    ...actual,
    getSources: vi.fn(),
    getLatestRun: vi.fn(),
    getSuggestions: vi.fn(),
    getAppSetup: vi.fn(),
    addTestAccount: vi.fn(),
    getRepoSource: vi.fn(),
  }
})

const m = {
  getSources: vi.mocked(api.getSources),
  getLatestRun: vi.mocked(api.getLatestRun),
  getSuggestions: vi.mocked(api.getSuggestions),
  getAppSetup: vi.mocked(api.getAppSetup),
  addTestAccount: vi.mocked(api.addTestAccount),
  getRepoSource: vi.mocked(api.getRepoSource),
}

const items: ChecklistItem[] = [{ id: 'i1', guidelineId: 'g1', category: 'Privacy', text: 'Text 1', itemName: 'Item 1', severity: 'major' }]
const account = (over: Partial<TestAccountView> = {}): TestAccountView => ({
  id: 'a1',
  label: 'Teen 15',
  ageGroup: 'under_18',
  age: 15,
  loginName: 'teen15@test.example',
  handles: [],
  hasPassword: true,
  updatedAt: '2026-11-04T09:00:00.000Z',
  ...over,
})
const setup = (over: Partial<AppSetupResponse> = {}): AppSetupResponse => ({
  app: { appUrl: 'http://127.0.0.1:53198', loginDomains: [], updatedAt: '2026-11-04T09:00:00.000Z' },
  accounts: [account(), account({ id: 'a2', label: 'Adult 30', ageGroup: 'adult', age: 30 })],
  secretKeyConfigured: true,
  ...over,
})

function Harness() {
  const evidence = useEvidence('p1', { enabled: true })
  return <EvidencePanel projectId="p1" role="auditor" evidence={evidence} locked={false} checklistItems={items} />
}

/** The folded one-line summary: the address sits in its own span inside it. */
async function summaryLine(dialog: HTMLElement, address: string) {
  return (await within(dialog).findByText(address, { selector: 'span' })).closest('p')!
}

async function renderOpen() {
  render(<Harness />)
  await userEvent.click(await screen.findByRole('button', { name: 'Open AI evidence' }))
  return screen.getByRole('dialog', { name: 'AI evidence assessment' })
}

beforeEach(() => {
  useStore.setState({ authToken: null })
  Object.values(m).forEach((fn) => fn.mockReset())
  m.getSources.mockResolvedValue({ source: null, permission: null })
  m.getLatestRun.mockResolvedValue({ run: null, pages: [] })
  m.getSuggestions.mockResolvedValue({ run: null, suggestions: [], decisions: [] })
  m.getAppSetup.mockResolvedValue(setup())
  m.getRepoSource.mockResolvedValue({ repo: null })
})

describe('the source step', () => {
  it('names the choice "Evidence source" and describes each option, keeping the option names', async () => {
    const dialog = await renderOpen()
    expect(within(dialog).getByRole('group', { name: 'Evidence source' })).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'App (test accounts)' })).toHaveAccessibleDescription('Sign in with test accounts and use the app')
    expect(within(dialog).getByRole('radio', { name: 'Code repository' })).toHaveAccessibleDescription('Read a public GitHub repository')
  })

  it('shows the three numbered steps', async () => {
    const dialog = await renderOpen()
    const headings = await within(dialog).findAllByRole('heading', { level: 3 })
    expect(headings.map((h) => h.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Step 1: Source/), expect.stringMatching(/^Step 2: Set up/), expect.stringMatching(/^Step 3: Items and run/)]),
    )
  })
})

describe('the set-up step', () => {
  it('folds a complete app set-up into one line with an Edit button', async () => {
    const user = userEvent.setup()
    const dialog = await renderOpen()
    const line = await summaryLine(dialog, 'http://127.0.0.1:53198')
    expect(line).toHaveTextContent('App · http://127.0.0.1:53198 · 2 test accounts ready')
    expect(within(dialog).queryByLabelText('App address')).not.toBeInTheDocument()
    const edit = within(dialog).getByRole('button', { name: 'Edit set-up' })
    expect(edit).toHaveAttribute('aria-expanded', 'false')

    await user.click(edit)
    expect(within(dialog).getByLabelText('App address')).toHaveValue('http://127.0.0.1:53198')
    expect(line).not.toBeInTheDocument()
    const done = within(dialog).getByRole('button', { name: 'Done editing set-up' })
    expect(done).toHaveAttribute('aria-expanded', 'true')

    await user.click(done)
    expect(within(dialog).queryByLabelText('App address')).not.toBeInTheDocument()
  })

  it('is open, with no Edit button, while the set-up is incomplete', async () => {
    m.getAppSetup.mockResolvedValue(setup({ accounts: [] }))
    const dialog = await renderOpen()
    expect(await within(dialog).findByLabelText('App address')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Edit set-up' })).not.toBeInTheDocument()
  })

  it('stays open after the set-up becomes complete, so a second account can be added', async () => {
    const user = userEvent.setup()
    m.getAppSetup.mockResolvedValue(setup({ accounts: [] }))
    m.addTestAccount.mockResolvedValue({ account: account() })
    const dialog = await renderOpen()
    await user.click(await within(dialog).findByRole('button', { name: 'Add test account' }))
    await user.type(within(dialog).getByLabelText('Account name'), 'Teen 15')
    await user.type(within(dialog).getByLabelText('Login name'), 'teen15')
    await user.type(within(dialog).getByLabelText(/^password/i), 'pw')
    m.getAppSetup.mockResolvedValue(setup({ accounts: [account()] }))
    await user.click(within(dialog).getByRole('button', { name: 'Save account' }))
    await waitFor(() => expect(within(dialog).getByText('Teen 15')).toBeInTheDocument())
    expect(within(dialog).getByLabelText('App address')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add test account' })).toBeInTheDocument()
  })

  it('folds a saved repository the same way', async () => {
    const user = userEvent.setup()
    m.getRepoSource.mockResolvedValue({ repo: { repoUrl: 'https://github.com/o/n', branch: 'dev', updatedAt: '2026-11-07T09:00:00.000Z' } })
    const dialog = await renderOpen()
    await user.click(within(dialog).getByRole('radio', { name: 'Code repository' }))
    expect(await summaryLine(dialog, 'https://github.com/o/n')).toHaveTextContent('Code repository · https://github.com/o/n · branch dev')
    expect(within(dialog).queryByLabelText('Repository address')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Edit set-up' }))
    expect(within(dialog).getByLabelText('Repository address')).toHaveValue('https://github.com/o/n')
  })

  it('keeps the repository form open while nothing is saved', async () => {
    const user = userEvent.setup()
    const dialog = await renderOpen()
    await user.click(within(dialog).getByRole('radio', { name: 'Code repository' }))
    expect(await within(dialog).findByLabelText('Repository address')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Edit set-up' })).not.toBeInTheDocument()
  })
})

describe('AppSetup: address and advanced', () => {
  const base = setup()

  it('keeps login domains in an Advanced fold, closed by default when none are saved', async () => {
    const user = userEvent.setup()
    render(<AppSetup projectId="p1" setup={base} onSaved={vi.fn()} />)
    const advanced = screen.getByRole('button', { name: 'Advanced' })
    expect(advanced).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Login domains (one per line)')).not.toBeInTheDocument()
    await user.click(advanced)
    expect(advanced).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Login domains (one per line)')).toHaveAccessibleDescription('Only needed if sign-in goes through another website.')
  })

  it('opens Advanced by default when login domains exist', () => {
    const withDomains = setup({ app: { ...base.app!, loginDomains: ['login.example'] } })
    render(<AppSetup projectId="p1" setup={withDomains} onSaved={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Login domains (one per line)')).toHaveValue('login.example')
  })

  it('makes "Save app address" the primary button', () => {
    render(<AppSetup projectId="p1" setup={base} onSaved={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save app address' }).className).toMatch(/\bbg-blue-600\b/)
  })
})
