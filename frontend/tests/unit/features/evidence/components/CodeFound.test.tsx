import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../../../../src/features/evidence/api'
import type { CodePieceView } from '../../../../../src/features/evidence/types'
import CodeFound from '../../../../../src/features/evidence/components/CodeFound'

vi.mock('../../../../../src/features/evidence/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../../src/features/evidence/api')>()), getCode: vi.fn() }))
const getCode = vi.mocked(api.getCode)

const piece = (over: Partial<CodePieceView> = {}): CodePieceView => ({
  id: 'p1',
  path: 'src/user.ts',
  startLine: 41,
  endLine: 43,
  code: 'const a = 1\nconst isPrivate = age < 18\nexport { a }',
  url: 'https://github.com/acme/social-app/blob/abc1234/src/user.ts#L41-L43',
  round: 1,
  quoted: false,
  ...over,
})

beforeEach(() => {
  getCode.mockReset()
})

describe('CodeFound', () => {
  it('shows the path, the line range and numbers each line from the start line', async () => {
    getCode.mockResolvedValue({ commitSha: 'abc1234def', repoUrl: 'https://github.com/acme/social-app', pieces: [piece()] })
    render(<CodeFound suggestionId="s-1" />)
    expect(screen.getByText('Loading the code…')).toBeInTheDocument()
    expect(await screen.findByText('src/user.ts')).toBeInTheDocument()
    expect(screen.getByText('lines 41–43')).toBeInTheDocument()
    for (const n of ['41', '42', '43']) expect(screen.getByText(n)).toBeInTheDocument()
    expect(screen.getByText(/isPrivate = age < 18/)).toBeInTheDocument()
    expect(getCode).toHaveBeenCalledWith('s-1')
  })

  it('keeps only phrasing content inside the code block', async () => {
    getCode.mockResolvedValue({ commitSha: 'abc1234def', repoUrl: null, pieces: [piece()] })
    const { container } = render(<CodeFound suggestionId="s-1" />)
    await screen.findByText('src/user.ts')
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.querySelector('div')).toBeNull()
    expect(pre?.querySelectorAll(':scope > span.flex')).toHaveLength(3)
  })

  it('shows the Quoted badge only on the quoted piece', async () => {
    getCode.mockResolvedValue({
      commitSha: 'abc1234',
      repoUrl: 'https://github.com/acme/social-app',
      pieces: [piece({ id: 'a', path: 'a.ts', quoted: true }), piece({ id: 'b', path: 'b.ts' })],
    })
    render(<CodeFound suggestionId="s-1" />)
    await screen.findByText('a.ts')
    const items = screen.getAllByRole('listitem')
    expect(within(items[0]).getByText('Quoted')).toBeInTheDocument()
    expect(within(items[1]).queryByText('Quoted')).toBeNull()
  })

  it('links to GitHub in a new tab, and gives a non-GitHub address no link', async () => {
    getCode.mockResolvedValue({
      commitSha: 'abc1234',
      repoUrl: null,
      pieces: [piece({ id: 'a', path: 'a.ts' }), piece({ id: 'b', path: 'b.ts', url: 'https://evil.example/x' }), piece({ id: 'c', path: 'c.ts', url: 'javascript:alert(1)' })],
    })
    render(<CodeFound suggestionId="s-1" />)
    await screen.findByText('a.ts')
    const links = screen.getAllByRole('link', { name: 'Open on GitHub' })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('says so when the code cannot be loaded', async () => {
    getCode.mockRejectedValue(new api.EvidenceApiError(500, 'boom'))
    render(<CodeFound suggestionId="s-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent("The code couldn't be loaded. Try again.")
  })

  it('says so when no code was kept', async () => {
    getCode.mockResolvedValue({ commitSha: null, repoUrl: null, pieces: [] })
    render(<CodeFound suggestionId="s-1" />)
    expect(await screen.findByText('No code was kept for this suggestion.')).toBeInTheDocument()
  })
})
