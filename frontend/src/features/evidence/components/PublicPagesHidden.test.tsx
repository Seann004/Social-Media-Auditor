import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { PUBLIC_PAGES_ENABLED } from '../config'
import { useStore } from '../../../store/useStore'
import { makePage, makeRun, makeSuggestion } from '../testFixtures'
import { useEvidence } from '../useEvidence'
import EvidencePanel from './EvidencePanel'
import SourceChoice from './SourceChoice'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    getSources: vi.fn(),
    getLatestRun: vi.fn(),
    getSuggestions: vi.fn(),
    getAppSetup: vi.fn(),
    getRepoSource: vi.fn(),
    reassess: vi.fn(),
  }
})

const m = {
  getSources: vi.mocked(api.getSources),
  getLatestRun: vi.mocked(api.getLatestRun),
  getSuggestions: vi.mocked(api.getSuggestions),
  getAppSetup: vi.mocked(api.getAppSetup),
  getRepoSource: vi.mocked(api.getRepoSource),
}

// No publicPagesEnabled prop: these use the shipped default.
function Harness({ role = 'auditor' as 'auditor' | 'head_auditor' }) {
  const evidence = useEvidence('p1', { enabled: true })
  return <EvidencePanel projectId="p1" role={role} evidence={evidence} locked={false} checklistItems={[]} />
}

/** The panel lives in a drawer: open it from the bar, as a user does. */
async function renderOpen(ui: React.ReactElement) {
  const view = render(ui)
  await userEvent.click(await screen.findByRole('button', { name: 'Open AI evidence' }))
  return view
}

beforeEach(() => {
  useStore.setState({ authToken: null })
  Object.values(m).forEach((fn) => fn.mockReset())
  m.getSources.mockResolvedValue({ source: null, permission: null })
  m.getLatestRun.mockResolvedValue({ run: null, pages: [] })
  m.getSuggestions.mockResolvedValue({ run: null, suggestions: [], decisions: [] })
  m.getAppSetup.mockResolvedValue({ app: null, accounts: [], secretKeyConfigured: true })
  m.getRepoSource.mockResolvedValue({ repo: null })
})

describe('Public pages hidden by default', () => {
  it('ships switched off', () => {
    expect(PUBLIC_PAGES_ENABLED).toBe(false)
  })

  it('offers exactly App and Code repository, App selected', async () => {
    await renderOpen(<Harness />)
    const radios = await screen.findAllByRole('radio')
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['app', 'repo'])
    expect(screen.getByRole('radio', { name: 'App (test accounts)' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /public pages/i })).not.toBeInTheDocument()
  })

  it('shows no page-links form, run button or permission control, even for a head auditor', async () => {
    await renderOpen(<Harness role="head_auditor" />)
    await screen.findAllByRole('radio')
    await waitFor(() => expect(m.getSources).toHaveBeenCalled())
    expect(screen.queryByLabelText(/website links/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run assessment' })).not.toBeInTheDocument()
    expect(screen.queryByText(/robots\.txt/i)).not.toBeInTheDocument()
  })

  it('still renders an old pages run, its cards and Re-assess', async () => {
    const run = makeRun({ source: 'pages' })
    m.getLatestRun.mockResolvedValue({ run, pages: [makePage()] })
    m.getSuggestions.mockResolvedValue({ run, suggestions: [makeSuggestion()], decisions: [] })
    await renderOpen(<Harness />)
    expect(await screen.findByRole('button', { name: 'Re-assess unfinished' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Re-assess all categories' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/website links/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /public pages/i })).not.toBeInTheDocument()
  })

  it('SourceChoice brings Public pages back when enabled', () => {
    render(<SourceChoice value="pages" onChange={() => {}} publicPagesEnabled />)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Public pages' })).toBeChecked()
  })
})
