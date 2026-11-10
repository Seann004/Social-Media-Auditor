import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '../../../lib/db'
import LinkedItemsPanel from './LinkedItemsPanel'

vi.mock('../../../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/db')>()
  return { ...actual, fetchMappings: vi.fn(), fetchMappingCoverage: vi.fn() }
})

const m = {
  coverage: vi.mocked(db.fetchMappingCoverage),
  mappings: vi.mocked(db.fetchMappings),
}

const COVERAGE: db.MappingCoverage = {
  guidelines: [{ guidelineId: 'G1', name: 'ONSA', totalItems: 10, linkedItems: 2 }],
  pairs: [],
  mappings: { suggested: 0, confirmed: 2, rejected: 0 },
  decisions: { accepted: 1, dismissed: 0 },
}

const GUIDELINES = [{ id: 'G1', name: 'ONSA Code', shortName: 'ONSA' }]

beforeEach(() => {
  vi.resetAllMocks()
})

describe('LinkedItemsPanel loading', () => {
  it('says it is loading instead of showing zeros and an empty list', () => {
    m.coverage.mockReturnValue(new Promise(() => {}))
    m.mappings.mockReturnValue(new Promise(() => {}))
    render(<LinkedItemsPanel guidelines={GUIDELINES} isAdmin />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText('n/a')).not.toBeInTheDocument()
  })

  it('shows the real figures once loaded', async () => {
    m.coverage.mockResolvedValue(COVERAGE)
    m.mappings.mockResolvedValue([])
    render(<LinkedItemsPanel guidelines={GUIDELINES} isAdmin />)
    await waitFor(() => expect(screen.queryByText(/loading linked items/i)).not.toBeInTheDocument())
    expect(screen.getByText('Confirmed links')).toBeInTheDocument()
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument()
  })

  it('shows the error, not the loading text, when loading fails', async () => {
    m.coverage.mockRejectedValue(new Error('network down'))
    m.mappings.mockResolvedValue([])
    render(<LinkedItemsPanel guidelines={GUIDELINES} isAdmin />)
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
    expect(screen.queryByText(/loading linked items/i)).not.toBeInTheDocument()
  })
})
