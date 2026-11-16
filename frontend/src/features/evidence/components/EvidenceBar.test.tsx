import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { useStore } from '../../../store/useStore'
import { makeRun, makeSuggestion } from '../testFixtures'
import type { AppSetupResponse } from '../types'
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
    getRunChanges: vi.fn(),
  }
})

const m = {
  getSources: vi.mocked(api.getSources),
  getLatestRun: vi.mocked(api.getLatestRun),
  getSuggestions: vi.mocked(api.getSuggestions),
  getAppSetup: vi.mocked(api.getAppSetup),
  getRepoSource: vi.mocked(api.getRepoSource),
  getRunChanges: vi.mocked(api.getRunChanges),
}

const item = (n: number): ChecklistItem => ({ id: `i${n}`, guidelineId: 'g1', category: 'Privacy', text: `Text ${n}`, itemName: `Item ${n}`, severity: 'major' })
const items = [item(1), item(2), item(3)]

const ready: AppSetupResponse = {
  app: { appUrl: 'https://app.example', loginDomains: [], updatedAt: '2026-11-04T09:00:00.000Z' },
  accounts: [{ id: 'a1', label: 'Teen 15', ageGroup: 'under_18', age: 15, loginName: 'teen15', handles: [], hasPassword: true, updatedAt: '2026-11-04T09:00:00.000Z' }],
  secretKeyConfigured: true,
}

function Harness({ locked = false }: { locked?: boolean }) {
  const evidence = useEvidence('p1', { enabled: true })
  return <EvidencePanel projectId="p1" role="auditor" evidence={evidence} locked={locked} checklistItems={items} />
}

const bar = () => screen.getByRole('region', { name: 'AI evidence assessment' })
const openButton = () => screen.getByRole('button', { name: 'Open AI evidence' })

beforeEach(() => {
  useStore.setState({ authToken: null })
  Object.values(m).forEach((fn) => fn.mockReset())
  m.getSources.mockResolvedValue({ source: null, permission: null })
  m.getLatestRun.mockResolvedValue({ run: null, pages: [] })
  m.getSuggestions.mockResolvedValue({ run: null, suggestions: [], decisions: [] })
  m.getAppSetup.mockResolvedValue(ready)
  m.getRepoSource.mockResolvedValue({ repo: null })
  m.getRunChanges.mockResolvedValue({ changes: [] })
})

describe('EvidenceBar', () => {
  it('says "Needs setup" for the App source when no address is saved', async () => {
    m.getAppSetup.mockResolvedValue({ ...ready, app: null })
    render(<Harness />)
    expect(await within(bar()).findByText('Needs setup')).toBeInTheDocument()
    expect(within(bar()).getByText('App')).toBeInTheDocument()
    expect(within(bar()).getByText('AI evidence')).toBeInTheDocument()
  })

  it('says "Ready" once the app and an account are saved', async () => {
    render(<Harness />)
    expect(await within(bar()).findByText('Ready')).toBeInTheDocument()
  })

  it('gives the last result', async () => {
    const run = makeRun({ source: 'app' })
    m.getLatestRun.mockResolvedValue({ run, pages: [] })
    m.getSuggestions.mockResolvedValue({
      run,
      suggestions: [makeSuggestion({ itemId: 'i1' }), makeSuggestion({ id: 's2', itemId: 'i2', flags: [{ type: 'low_confidence', reason: 'x' }] })],
      decisions: [],
    })
    render(<Harness />)
    expect(await within(bar()).findByText('Last run: 2 suggestions · 1 flagged')).toBeInTheDocument()
  })

  it('shows a spinner and the item being checked while a run is going', async () => {
    m.getLatestRun.mockResolvedValue({
      run: makeRun({ source: 'app', status: 'assessing', finishedAt: null, currentItemId: 'i2', categoriesDone: 1, categoriesTotal: 3 }),
      pages: [],
    })
    render(<Harness />)
    const text = await within(bar()).findByText('Checking Item 2 · 2 of 3')
    expect(text.closest('[data-running="true"]')).not.toBeNull()
    expect(bar().querySelector('.animate-spin')).not.toBeNull()
  })

  it('says the audit is locked', async () => {
    render(<Harness locked />)
    expect(await within(bar()).findByText('Audit locked · no new runs')).toBeInTheDocument()
  })

  it('keeps the suggestions-only note reachable from the bar', async () => {
    render(<Harness />)
    const info = await within(bar()).findByRole('button', { name: 'About AI suggestions' })
    expect(info).toHaveAccessibleDescription('Suggestions only. Nothing changes your answers or the score until you accept or override it.')
  })

  it('offers no Run shortcut on the bar', async () => {
    render(<Harness />)
    await within(bar()).findByText('Ready')
    expect(within(bar()).getAllByRole('button').map((b) => b.textContent?.trim() || b.getAttribute('aria-label'))).toEqual([
      'About AI suggestions',
      'Open AI evidence',
    ])
  })
})

describe('EvidenceDrawer', () => {
  it('starts closed: nothing auto-opens', async () => {
    render(<Harness />)
    await within(bar()).findByText('Ready')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens as a non-modal dialog named "AI evidence assessment", moving focus inside', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(openButton())
    const dialog = screen.getByRole('dialog', { name: 'AI evidence assessment' })
    expect(dialog).toHaveAttribute('aria-modal', 'false')
    expect(openButton()).toHaveAttribute('aria-expanded', 'true')
    expect(openButton()).toHaveAttribute('aria-controls', dialog.id)
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    expect(within(dialog).getByText('Suggestions only. Nothing changes your answers or the score until you accept or override it.')).toBeInTheDocument()
    // The old panel content lives inside the drawer.
    expect(within(dialog).getByRole('radio', { name: 'App (test accounts)' })).toBeChecked()
  })

  it('closes on Escape and gives focus back to "Open AI evidence"', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(openButton())
    await waitFor(() => expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton()).toHaveFocus()
  })

  it('closes with the ✕ button and gives focus back', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(openButton())
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close AI evidence' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton()).toHaveFocus()
  })

  it('dims the page behind with a grey backdrop at every width, and a click on it closes the drawer', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness />)
    await within(bar()).findByText('Ready')
    expect(container.querySelector('[data-drawer-backdrop]')).toBeNull()
    await user.click(openButton())
    const backdrop = container.querySelector('[data-drawer-backdrop]')!
    expect(backdrop).not.toBeNull()
    expect(backdrop.className).not.toMatch(/(^|\s)lg:hidden(\s|$)/)
    expect(backdrop.className).toMatch(/(^|\s)bg-slate-900\/40(\s|$)/)
    await user.click(backdrop as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is half the window wide on desktop and covers most of a narrow screen', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(openButton())
    const classes = screen.getByRole('dialog').className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['fixed', 'right-0', 'w-[92vw]', 'lg:w-[50vw]', 'lg:max-w-none']))
    expect(classes).not.toContain('lg:w-[440px]')
  })

  it('keeps picked items while it is closed and opened again', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(openButton())
    await user.click(await screen.findByRole('checkbox', { name: 'Item 2' }))
    await user.keyboard('{Escape}')
    await user.click(openButton())
    expect(screen.getByRole('checkbox', { name: 'Item 2' })).toBeChecked()
  })
})
