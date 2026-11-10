import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { EvidenceApiError } from '../api'
import { useStore } from '../../../store/useStore'
import { makeRun, makeSuggestion } from '../testFixtures'
import type { AppChangeView, AppSetupResponse, TestAccountView } from '../types'
import { useEvidence } from '../useEvidence'
import type { ChecklistItem, UserRole } from '../../../types'
import EvidencePanel from './EvidencePanel'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    getSources: vi.fn(),
    saveSources: vi.fn(),
    setPermission: vi.fn(),
    startRun: vi.fn(),
    reassess: vi.fn(),
    getLatestRun: vi.fn(),
    getSuggestions: vi.fn(),
    getAppSetup: vi.fn(),
    saveAppSource: vi.fn(),
    addTestAccount: vi.fn(),
    updateTestAccount: vi.fn(),
    deleteTestAccount: vi.fn(),
    startAppRun: vi.fn(),
    getRunChanges: vi.fn(),
  }
})

const m = {
  getSources: vi.mocked(api.getSources),
  startRun: vi.mocked(api.startRun),
  reassess: vi.mocked(api.reassess),
  getLatestRun: vi.mocked(api.getLatestRun),
  getSuggestions: vi.mocked(api.getSuggestions),
  getAppSetup: vi.mocked(api.getAppSetup),
  saveAppSource: vi.mocked(api.saveAppSource),
  addTestAccount: vi.mocked(api.addTestAccount),
  updateTestAccount: vi.mocked(api.updateTestAccount),
  startAppRun: vi.mocked(api.startAppRun),
  getRunChanges: vi.mocked(api.getRunChanges),
}

const item = (n: number, category = 'Privacy'): ChecklistItem => ({
  id: `i${n}`,
  guidelineId: 'g1',
  category,
  text: `Text ${n}`,
  itemName: `Item ${n}`,
  severity: 'high',
})
const manyItems = [...Array.from({ length: 8 }, (_, i) => item(i + 1)), ...Array.from({ length: 4 }, (_, i) => item(i + 9, 'Safety'))]

function Harness({ role = 'auditor', locked = false, items = manyItems }: { role?: UserRole; locked?: boolean; items?: ChecklistItem[] }) {
  const evidence = useEvidence('p1', { enabled: role !== 'admin' })
  return <EvidencePanel projectId="p1" role={role} evidence={evidence} locked={locked} checklistItems={items} publicPagesEnabled />
}

const account = (over: Partial<TestAccountView> = {}): TestAccountView => ({
  id: 'a1',
  label: 'Teen 15',
  ageGroup: 'under_18',
  age: 15,
  loginName: 'teen15@test.example',
  handles: ['teen15'],
  hasPassword: true,
  updatedAt: '2026-11-04T09:00:00.000Z',
  ...over,
})
const setup = (over: Partial<AppSetupResponse> = {}): AppSetupResponse => ({
  app: { appUrl: 'https://app.example', loginDomains: ['login.example'], updatedAt: '2026-11-04T09:00:00.000Z' },
  accounts: [account()],
  secretKeyConfigured: true,
  ...over,
})
const change = (over: Partial<AppChangeView> = {}): AppChangeView => ({
  id: 'c1',
  itemId: 'i1',
  accountLabel: 'Teen 15',
  pageUrl: '/settings',
  control: 'Private profile',
  before: 'off',
  after: 'on',
  restored: false,
  restoreDetail: 'Could not switch it back.',
  ...over,
})

beforeEach(() => {
  useStore.setState({ authToken: null })
  Object.values(m).forEach((fn) => fn.mockReset())
  m.getSources.mockResolvedValue({ source: null, permission: null })
  m.getLatestRun.mockResolvedValue({ run: null, pages: [] })
  m.getSuggestions.mockResolvedValue({ run: null, suggestions: [], decisions: [] })
  m.getAppSetup.mockResolvedValue(setup())
  m.getRunChanges.mockResolvedValue({ changes: [] })
})

async function openApp(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: /app \(test accounts\)/i }))
  await screen.findByLabelText(/app address/i)
}

describe('App source in the evidence panel', () => {
  it('switches between App and Public pages; Public pages shows the existing link form unchanged', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(await screen.findByLabelText(/website links/i)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /public pages/i })).toBeChecked()
    await openApp(user)
    expect(screen.queryByLabelText(/website links/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /public pages/i }))
    expect(await screen.findByLabelText(/website links/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run assessment/i })).toBeInTheDocument()
  })

  it('defaults to App when the last result run was an app run', async () => {
    m.getSuggestions.mockResolvedValue({ run: makeRun({ source: 'app' }), suggestions: [], decisions: [] })
    render(<Harness />)
    await waitFor(() => expect(screen.getByRole('radio', { name: /app \(test accounts\)/i })).toBeChecked())
  })

  it('saves the app address and login domains and shows a server sentence on 400', async () => {
    const user = userEvent.setup()
    m.saveAppSource.mockResolvedValueOnce({ app: setup().app! })
    render(<Harness />)
    await openApp(user)
    const address = screen.getByLabelText(/app address/i)
    const domains = screen.getByLabelText(/login domains/i)
    expect(address).toHaveValue('https://app.example')
    await user.clear(address)
    await user.type(address, 'https://new.example')
    await user.clear(domains)
    await user.type(domains, 'a.example{Enter}b.example')
    await user.click(screen.getByRole('button', { name: /save app address/i }))
    expect(m.saveAppSource).toHaveBeenCalledWith('p1', 'https://new.example', ['a.example', 'b.example'])
    await waitFor(() => expect(m.getAppSetup).toHaveBeenCalledTimes(2))

    m.saveAppSource.mockRejectedValueOnce(new EvidenceApiError(400, 'That address points at a private network.'))
    await user.click(screen.getByRole('button', { name: /save app address/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That address points at a private network.')
  })

  it('adds a test account; the password field is type password and is cleared after saving', async () => {
    const user = userEvent.setup()
    m.addTestAccount.mockResolvedValue({ account: account({ id: 'a2', label: 'Adult' }) })
    render(<Harness />)
    await openApp(user)
    await user.click(screen.getByRole('button', { name: /add test account/i }))
    const password = screen.getByLabelText(/^password/i)
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'new-password')
    await user.type(screen.getByLabelText(/account name/i), 'Adult')
    await user.type(screen.getByLabelText(/login name/i), 'adult@test.example')
    await user.type(screen.getByLabelText(/display handles/i), 'adult1')
    await user.type(password, 'S3cret!pw')
    await user.click(screen.getByRole('button', { name: /save account/i }))
    expect(m.addTestAccount).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ label: 'Adult', loginName: 'adult@test.example', password: 'S3cret!pw', handles: ['adult1'] }),
    )
    await waitFor(() => expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument())
    expect(document.body.innerHTML).not.toContain('S3cret!pw')
    await user.click(screen.getByRole('button', { name: /add test account/i }))
    expect(screen.getByLabelText(/^password/i)).toHaveValue('')
  })

  it('editing an account never shows the password and a blank password keeps the saved one', async () => {
    const user = userEvent.setup()
    const real = await vi.importActual<typeof import('../api')>('../api')
    m.updateTestAccount.mockImplementation(real.updateTestAccount)
    useStore.setState({ authToken: 'tok' })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ account: account() }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<Harness />)
    await openApp(user)
    await user.click(await screen.findByRole('button', { name: /edit teen 15/i }))
    const password = screen.getByLabelText(/^password/i)
    expect(password).toHaveValue('')
    expect(password).toHaveAttribute('placeholder', 'Leave blank to keep the saved password')
    expect(screen.getByLabelText(/display handles/i)).toHaveValue('teen15')
    await user.click(screen.getByRole('button', { name: /save account/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/test-accounts/a1')
    expect(JSON.parse(init.body as string)).not.toHaveProperty('password')
    vi.unstubAllGlobals()
  })

  it('lists accounts with label, age group and "Password saved", never a password', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openApp(user)
    const row = (await screen.findByText('Teen 15')).closest('li')!
    expect(within(row).getByText(/under 18/i)).toBeInTheDocument()
    expect(within(row).getByText('Password saved')).toBeInTheDocument()
    expect(row.querySelector('input')).toBeNull()
  })

  it('the item picker groups by category, caps at 10 and shows the cap note', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openApp(user)
    expect(screen.getByRole('group', { name: 'Privacy' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Safety' })).toBeInTheDocument()
    expect(screen.queryByText('Up to 10 items per app run.')).not.toBeInTheDocument()
    for (let n = 1; n <= 10; n += 1) await user.click(screen.getByRole('checkbox', { name: `Item ${n}` }))
    expect(screen.getByText('Up to 10 items per app run.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Item 11' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Item 10' })).toBeEnabled()
    await user.click(screen.getByRole('checkbox', { name: 'Item 10' }))
    expect(screen.getByRole('checkbox', { name: 'Item 11' })).toBeEnabled()
  })

  it('Run is disabled with the appRunBlocker sentence until ready, then starts an app run with the picked ids', async () => {
    const user = userEvent.setup()
    m.getAppSetup.mockResolvedValue(setup({ app: null, accounts: [] }))
    m.startAppRun.mockResolvedValue({ run: makeRun({ source: 'app', status: 'queued' }) })
    render(<Harness />)
    await user.click(await screen.findByRole('radio', { name: /app \(test accounts\)/i }))
    const run = await screen.findByRole('button', { name: /run app check/i })
    expect(run).toBeDisabled()
    expect(screen.getByText('Save the app address first.')).toBeInTheDocument()
    m.getAppSetup.mockResolvedValue(setup())
    m.saveAppSource.mockResolvedValue({ app: setup().app! })
    await user.type(screen.getByLabelText(/app address/i), 'https://app.example')
    await user.click(screen.getByRole('button', { name: /save app address/i }))
    expect(await screen.findByText('Pick at least one item.')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Item 2' }))
    await user.click(screen.getByRole('checkbox', { name: 'Item 9' }))
    expect(screen.getByRole('button', { name: /run app check/i })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /run app check/i }))
    expect(m.startAppRun).toHaveBeenCalledWith('p1', ['i2', 'i9'])
  })

  it('shows the current item and "step 3 of 15" while an app run is checking', async () => {
    m.getLatestRun.mockResolvedValue({
      run: makeRun({ source: 'app', status: 'assessing', finishedAt: null, currentItemId: 'i2', currentStep: 3, categoriesDone: 1, categoriesTotal: 4, checkedItemIds: ['i1', 'i2'] }),
      pages: [],
    })
    render(<Harness />)
    expect(await screen.findByText('Checking in the app: Item 2 · step 3 of 15')).toBeInTheDocument()
    expect(screen.getByText('Items checked: 1 of 4')).toBeInTheDocument()
  })

  it('the summary lists not-checked items, settings left changed and settings put back', async () => {
    const run = makeRun({ source: 'app', status: 'partial', currentStep: 7, checkedItemIds: ['i1'], uncheckedItemIds: ['i3', 'i4'] })
    m.getLatestRun.mockResolvedValue({ run, pages: [] })
    m.getSuggestions.mockResolvedValue({ run, suggestions: [makeSuggestion({ source: 'app' })], decisions: [] })
    m.getRunChanges.mockResolvedValue({
      changes: [change(), change({ id: 'c2', control: 'Location', before: 'on', after: 'off', restored: true, restoreDetail: 'Put back.' })],
    })
    render(<Harness />)
    expect(await screen.findByText('Not checked: Item 3, Item 4')).toBeInTheDocument()
    expect(screen.queryByText(/steps/i)).not.toBeInTheDocument()
    expect(m.getRunChanges).toHaveBeenCalledWith('p1', 'run-1')
    const left = await screen.findByRole('heading', { name: 'Left changed' })
    expect(left.parentElement).toHaveTextContent('Teen 15: "Private profile" on /settings is on (was off). Could not switch it back.')
    const back = screen.getByRole('heading', { name: 'Put back' })
    expect(back.parentElement).toHaveTextContent('Teen 15: "Location" on /settings is off (was on). Put back.')
  })

  it('counts not-checked items that are no longer on the checklist', async () => {
    const run = makeRun({ source: 'app', status: 'partial', checkedItemIds: ['i1'], uncheckedItemIds: ['i3', 'gone'] })
    m.getLatestRun.mockResolvedValue({ run, pages: [] })
    m.getSuggestions.mockResolvedValue({ run, suggestions: [], decisions: [] })
    render(<Harness />)
    expect(await screen.findByText('Not checked: Item 3, 1 item no longer on the checklist')).toBeInTheDocument()
  })

  it('says so and offers Retry when the changed settings cannot be loaded', async () => {
    const user = userEvent.setup()
    const run = makeRun({ source: 'app' })
    m.getLatestRun.mockResolvedValue({ run, pages: [] })
    m.getSuggestions.mockResolvedValue({ run, suggestions: [], decisions: [] })
    m.getRunChanges.mockRejectedValueOnce(new EvidenceApiError(500, 'x'))
    render(<Harness />)
    expect(await screen.findByText('The changed settings of this run could not be loaded.')).toBeInTheDocument()
    m.getRunChanges.mockResolvedValue({ changes: [change()] })
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('heading', { name: 'Left changed' })).toBeInTheDocument()
    expect(screen.queryByText('The changed settings of this run could not be loaded.')).not.toBeInTheDocument()
  })

  it('offers Re-assess after an app run and calls the re-assess API', async () => {
    const user = userEvent.setup()
    const run = makeRun({ source: 'app' })
    m.getLatestRun.mockResolvedValue({ run, pages: [] })
    m.getSuggestions.mockResolvedValue({ run, suggestions: [], decisions: [] })
    m.reassess.mockResolvedValue({ run })
    render(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Re-assess unfinished items' }))
    expect(m.reassess).toHaveBeenCalledWith('p1', 'run-1', 'unfinished')
    await user.click(screen.getByRole('button', { name: 'Re-assess all checked items' }))
    expect(m.reassess).toHaveBeenCalledWith('p1', 'run-1', 'all')
    expect(screen.queryByRole('button', { name: /^run assessment/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /categories/i })).not.toBeInTheDocument()
  })

  it('names the Re-assess buttons after the result run, whatever source is chosen', async () => {
    const user = userEvent.setup()
    const run = makeRun({ source: 'app' })
    m.getLatestRun.mockResolvedValue({ run, pages: [] })
    m.getSuggestions.mockResolvedValue({ run, suggestions: [], decisions: [] })
    render(<Harness />)
    await screen.findByRole('button', { name: 'Re-assess unfinished items' })
    await user.click(screen.getByRole('radio', { name: /public pages/i }))
    expect(screen.getByRole('button', { name: 'Re-assess unfinished items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-assess all checked items' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /re-assess all categories/i })).not.toBeInTheDocument()
  })

  it('shows "starting" instead of step 0 between items', async () => {
    m.getLatestRun.mockResolvedValue({
      run: makeRun({ source: 'app', status: 'assessing', finishedAt: null, currentItemId: 'i2', currentStep: 0, categoriesTotal: 2 }),
      pages: [],
    })
    render(<Harness />)
    expect(await screen.findByText('Checking in the app: Item 2 · starting')).toBeInTheDocument()
  })

  it('links the cap note to the disabled boxes and drops picked items that left the checklist', async () => {
    const user = userEvent.setup()
    m.startAppRun.mockResolvedValue({ run: makeRun({ source: 'app', status: 'queued' }) })
    const view = render(<Harness />)
    await openApp(user)
    for (let n = 1; n <= 10; n += 1) await user.click(screen.getByRole('checkbox', { name: `Item ${n}` }))
    const note = screen.getByText('Up to 10 items per app run.')
    expect(screen.getByRole('checkbox', { name: 'Item 11' })).toHaveAttribute('aria-describedby', note.id)
    view.rerender(<Harness items={manyItems.slice(1, 3)} />)
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Item 1' })).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /run app check/i }))
    expect(m.startAppRun).toHaveBeenCalledWith('p1', ['i2', 'i3'])
  })

  it('says the server is not set up when secretKeyConfigured is false, and pages runs still work', async () => {
    const user = userEvent.setup()
    m.getAppSetup.mockResolvedValue(setup({ secretKeyConfigured: false }))
    m.getSources.mockResolvedValue({ source: { id: 's', projectId: 'p1', startUrls: ['https://a.example/'], createdBy: 'u1', createdAt: '2026-11-04T09:00:00.000Z' }, permission: null })
    m.startRun.mockResolvedValue({ run: makeRun({ status: 'queued' }) })
    render(<Harness />)
    await user.click(await screen.findByRole('radio', { name: /app \(test accounts\)/i }))
    expect(await screen.findByText("Checking inside the app isn't set up on the server yet.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run app check/i })).toBeDisabled()
    expect(screen.getByLabelText(/app address/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove teen 15/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add test account/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit teen 15/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /public pages/i }))
    await waitFor(() => expect(screen.getByLabelText(/website links/i)).toHaveValue('https://a.example/'))
    await user.click(screen.getByRole('button', { name: /^run assessment/i }))
    expect(m.startRun).toHaveBeenCalledWith('p1')
  })

  it('Head Auditor can set up and run; the panel stays hidden for Admin', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness role="head_auditor" />)
    await openApp(user)
    expect(screen.getByRole('button', { name: /run app check/i })).toBeInTheDocument()
    unmount()
    const admin = render(<Harness role="admin" />)
    expect(admin.container).toBeEmptyDOMElement()
    expect(m.getAppSetup).toHaveBeenCalledTimes(1)
  })
})
