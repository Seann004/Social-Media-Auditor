import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import type { AppChangeView, AppStepView } from '../types'
import ReplaySteps from './ReplaySteps'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getSuggestionSteps: vi.fn(),
  getScreenshotUrl: vi.fn(),
}))
const getSteps = vi.mocked(api.getSuggestionSteps)
const getShot = vi.mocked(api.getScreenshotUrl)

const step = (over: Partial<AppStepView> = {}): AppStepView => ({
  id: 'st-1',
  position: 1,
  accountLabel: 'Teen 15',
  line: 'Opened the home page',
  outcome: 'done',
  refusalReason: null,
  pageId: 'pg-1',
  hasScreenshot: true,
  ...over,
})
const change = (over: Partial<AppChangeView> = {}): AppChangeView => ({
  id: 'c-1',
  itemId: 'item-1',
  accountLabel: 'Teen 15',
  pageUrl: 'https://app.test/settings',
  control: 'Private account',
  before: 'off',
  after: 'on',
  restored: false,
  restoreDetail: null,
  ...over,
})

const THREE = [
  step({ id: 'a', position: 1, line: 'Opened the home page', pageId: 'pg-1' }),
  step({ id: 'b', position: 2, line: 'Opened Settings', pageId: 'pg-2' }),
  step({ id: 'c', position: 3, line: 'Read the privacy options', pageId: 'pg-3' }),
]

beforeEach(() => {
  getSteps.mockReset()
  getShot.mockReset().mockImplementation(async (_kind, id) => `https://files.example/${id}.jpg`)
})

async function open(steps: AppStepView[], changes: AppChangeView[] = []) {
  getSteps.mockResolvedValue({ steps, changes })
  const onClose = vi.fn()
  render(<ReplaySteps suggestionId="s-1" onClose={onClose} />)
  await screen.findByRole('list', { name: 'Steps' })
  return onClose
}

describe('ReplaySteps', () => {
  it('lists every step in order with its line, and shows the first step’s screenshot', async () => {
    await open(THREE)
    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Opened the home page')
    expect(items[1]).toHaveTextContent('Opened Settings')
    expect(items[2]).toHaveTextContent('Read the privacy options')
    expect(getShot).toHaveBeenCalledWith('page', 'pg-1')
    const img = await screen.findByRole('img', { name: 'Screenshot of step 1' })
    expect(img).toHaveAttribute('src', 'https://files.example/pg-1.jpg')
  })

  it('Next and Previous, and the arrow keys, move between steps', async () => {
    const user = userEvent.setup()
    await open(THREE)
    const previous = screen.getByRole('button', { name: 'Previous' })
    const next = screen.getByRole('button', { name: 'Next' })
    expect(previous).toBeDisabled()
    await user.click(next)
    expect(await screen.findByRole('img', { name: 'Screenshot of step 2' })).toHaveAttribute('src', 'https://files.example/pg-2.jpg')
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('img', { name: 'Screenshot of step 3' })).toBeInTheDocument()
    expect(next).toBeDisabled()
    await user.keyboard('{ArrowLeft}')
    expect(await screen.findByRole('img', { name: 'Screenshot of step 2' })).toBeInTheDocument()
    await user.click(previous)
    expect(await screen.findByRole('img', { name: 'Screenshot of step 1' })).toBeInTheDocument()
  })

  it('shows refused steps with their reason and anything not put back', async () => {
    const user = userEvent.setup()
    await open(
      [
        step({ id: 'a', position: 1, line: 'Opened Settings' }),
        step({ id: 'b', position: 2, line: 'Tried to press Delete account', outcome: 'refused', refusalReason: 'Deleting an account is never allowed.', pageId: null, hasScreenshot: false }),
      ],
      [change({ id: 'c1', control: 'Private account', restored: false }), change({ id: 'c2', control: 'Show activity', restored: true })],
    )
    const list = screen.getByRole('list', { name: 'Steps' })
    expect(within(list).getByText('Refused')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Deleting an account is never allowed.')).toBeInTheDocument()
    expect(screen.getByText('No screenshot for this step')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Left changed' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Put back' })).toBeInTheDocument()
    expect(screen.getByText(/Private account/)).toBeInTheDocument()
  })

  it('renders step lines as text, never as HTML', async () => {
    const container = document.body
    await open([step({ line: '<img src=x onerror=alert(1)><b>bold</b>' })])
    expect(screen.getAllByText('<img src=x onerror=alert(1)><b>bold</b>').length).toBeGreaterThan(0)
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })

  it('a 404 shows "This suggestion has no recorded steps."', async () => {
    getSteps.mockRejectedValue(new api.EvidenceApiError(404, 'That was not found.'))
    render(<ReplaySteps suggestionId="s-1" onClose={vi.fn()} />)
    expect(await screen.findByText('This suggestion has no recorded steps.')).toBeInTheDocument()
  })

  it('says why when a screenshot cannot load, and closes on Escape', async () => {
    const user = userEvent.setup()
    getShot.mockRejectedValue(new Error('gone'))
    const onClose = await open([step()])
    await waitFor(() => expect(screen.getByText('The screenshot could not be loaded.')).toBeInTheDocument())
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('moves only on plain Left and Right: Up, Down, modified keys and keys typed in a field are left alone', async () => {
    const user = userEvent.setup()
    await open(THREE)
    const field = document.createElement('input')
    document.body.appendChild(field)
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')
    await user.keyboard('{Control>}{ArrowRight}{/Control}')
    field.focus()
    await user.keyboard('{ArrowRight}')
    field.remove()
    expect(screen.getByRole('img', { name: 'Screenshot of step 1' })).toBeInTheDocument()
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    document.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
  })
})
