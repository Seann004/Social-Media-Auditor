import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { useStore } from '../../../store/useStore'
import type { AppSetupResponse, TestAccountView } from '../types'
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
    startAppRun: vi.fn(),
  }
})

const m = {
  getSources: vi.mocked(api.getSources),
  getLatestRun: vi.mocked(api.getLatestRun),
  getSuggestions: vi.mocked(api.getSuggestions),
  getAppSetup: vi.mocked(api.getAppSetup),
  getRepoSource: vi.mocked(api.getRepoSource),
  startAppRun: vi.mocked(api.startAppRun),
}

const items: ChecklistItem[] = [1, 2, 3].map((n) => ({ id: `i${n}`, guidelineId: 'g1', category: 'Privacy', text: `Text ${n}`, itemName: `Item ${n}`, severity: 'major' }))
const account = (id: string, label: string): TestAccountView => ({ id, label, ageGroup: 'adult', age: 30, loginName: id, handles: [], hasPassword: true, updatedAt: '' })
const setup = (over: Partial<AppSetupResponse> = {}): AppSetupResponse => ({
  app: { appUrl: 'https://app.example', loginDomains: [], updatedAt: '' },
  accounts: [account('a1', 'One'), account('a2', 'Two')],
  secretKeyConfigured: true,
  ...over,
})

function Harness({ locked = false }: { locked?: boolean }) {
  const evidence = useEvidence('p1', { enabled: true })
  return <EvidencePanel projectId="p1" role="auditor" evidence={evidence} locked={locked} checklistItems={items} />
}

async function renderOpen(ui = <Harness />) {
  render(ui)
  await userEvent.click(await screen.findByRole('button', { name: 'Open AI evidence' }))
  return screen.getByRole('dialog', { name: 'AI evidence assessment' })
}

const runBar = (dialog: HTMLElement) => dialog.querySelector<HTMLElement>('[data-run-bar]')!

beforeEach(() => {
  useStore.setState({ authToken: null })
  Object.values(m).forEach((fn) => fn.mockReset())
  m.getSources.mockResolvedValue({ source: null, permission: null })
  m.getLatestRun.mockResolvedValue({ run: null, pages: [] })
  m.getSuggestions.mockResolvedValue({ run: null, suggestions: [], decisions: [] })
  m.getAppSetup.mockResolvedValue(setup())
  m.getRepoSource.mockResolvedValue({ repo: null })
})

describe('the sticky action bar', () => {
  it('sits at the bottom of the drawer, last in its scrolling content', async () => {
    const dialog = await renderOpen()
    const bar = await within(dialog).findByRole('group', { name: 'Run' })
    expect(bar).toBe(runBar(dialog))
    expect(bar.className.split(/\s+/)).toEqual(expect.arrayContaining(['sticky', 'bottom-0']))
    expect(bar.parentElement!.lastElementChild).toBe(bar)
  })

  it('sums up the picked items and the ready accounts beside "Run app check"', async () => {
    const user = userEvent.setup()
    const dialog = await renderOpen()
    const bar = await within(dialog).findByRole('group', { name: 'Run' })
    expect(within(bar).getByText('0 items · 2 accounts ready')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Item 1' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Item 3' }))
    expect(within(bar).getByText('2 items · 2 accounts ready')).toBeInTheDocument()
    const run = within(bar).getByRole('button', { name: 'Run app check' })
    expect(run).toBeEnabled()
    expect(run).not.toHaveAttribute('aria-describedby')
    m.startAppRun.mockResolvedValue({ run: { ...(await import('../testFixtures')).makeRun({ source: 'app', status: 'queued' }) } })
    await user.click(run)
    expect(m.startAppRun).toHaveBeenCalledWith('p1', ['i1', 'i3'])
  })

  it('shows why Run is disabled beside it, as its description', async () => {
    m.getAppSetup.mockResolvedValue(setup({ app: null }))
    const dialog = await renderOpen()
    const bar = await within(dialog).findByRole('group', { name: 'Run' })
    const run = within(bar).getByRole('button', { name: 'Run app check' })
    expect(run).toBeDisabled()
    expect(run).toHaveAccessibleDescription('Save the app address first.')
    expect(within(bar).getByText('Save the app address first.')).toBeInTheDocument()
  })

  it('gives the repository reason for "Check the code"', async () => {
    const user = userEvent.setup()
    const dialog = await renderOpen()
    await user.click(within(dialog).getByRole('radio', { name: 'Code repository' }))
    const bar = await within(dialog).findByRole('group', { name: 'Run' })
    expect(within(bar).getByText('0 items · no repository saved')).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Check the code' })).toHaveAccessibleDescription('Save the repository address first.')
  })

  it('has no button on a locked audit, only the reason', async () => {
    const dialog = await renderOpen(<Harness locked />)
    const bar = await within(dialog).findByRole('group', { name: 'Run' })
    expect(within(bar).queryByRole('button')).not.toBeInTheDocument()
    expect(within(bar).getByText('This audit is locked, so no runs can start.')).toBeInTheDocument()
  })
})
