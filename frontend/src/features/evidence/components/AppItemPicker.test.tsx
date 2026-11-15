import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { MAX_APP_ITEMS, toPickItems } from '../appState'
import type { ChecklistItem, Severity } from '../../../types'
import AppItemPicker from './AppItemPicker'

const item = (n: number, category = 'Privacy', severity: Severity = 'major'): ChecklistItem => ({
  id: `i${n}`,
  guidelineId: 'g1',
  category,
  text: `Text ${n}`,
  itemName: `Item ${n}`,
  itemCode: `P-${n}`,
  severity,
})

function Picker({ count = 3, limit }: { count?: number; limit?: number }) {
  const all = Array.from({ length: count }, (_, i) => item(i + 1, i < 8 ? 'Privacy' : 'Safety', i === 0 ? 'critical' : 'major'))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  return <AppItemPicker items={toPickItems(all)} picked={picked} onChange={setPicked} limit={limit} />
}

describe('AppItemPicker', () => {
  it('shows the item code and a severity chip beside each item, keeping the checkbox named by the item text', () => {
    render(<Picker />)
    const box = screen.getByRole('checkbox', { name: 'Item 1' })
    const row = box.closest('li')!
    expect(within(row).getByText('P-1')).toBeInTheDocument()
    expect(within(row).getByText('Critical')).toBeInTheDocument()
    expect(within(screen.getByRole('checkbox', { name: 'Item 2' }).closest('li')!).getByText('Major')).toBeInTheDocument()
  })

  it('counts against the real limit and gives the free-plan tip', async () => {
    const user = userEvent.setup()
    render(<Picker />)
    expect(screen.getByText(`0 of ${MAX_APP_ITEMS} picked`)).toBeInTheDocument()
    expect(screen.getByText("About 3 items works best on Groq's free plan")).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Item 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Item 3' }))
    expect(screen.getByText(`2 of ${MAX_APP_ITEMS} picked`)).toBeInTheDocument()
  })

  it('Select all picks every item, and Clear empties the pick', async () => {
    const user = userEvent.setup()
    render(<Picker />)
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getAllByRole('checkbox').every((b) => (b as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getAllByRole('checkbox').some((b) => (b as HTMLInputElement).checked)).toBe(false)
    expect(screen.getByText(`0 of ${MAX_APP_ITEMS} picked`)).toBeInTheDocument()
  })

  it('Select all stops at the limit and shows the cap note', async () => {
    const user = userEvent.setup()
    render(<Picker count={12} />)
    await user.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText('10 of 10 picked')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Item 10' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Item 11' })).toBeDisabled()
    expect(screen.getByText('Up to 10 items per app run.')).toBeInTheDocument()
  })

  it('folds a category away and back, keeping its picks; categories start open', async () => {
    const user = userEvent.setup()
    render(<Picker count={10} />)
    const privacy = screen.getByRole('button', { name: 'Privacy' })
    expect(privacy).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('checkbox', { name: 'Item 2' }))
    await user.click(privacy)
    expect(privacy).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('checkbox', { name: 'Item 2' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Privacy' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Item 9' })).toBeInTheDocument()
    expect(screen.getByText('1 of 10 picked')).toBeInTheDocument()
    await user.click(privacy)
    expect(screen.getByRole('checkbox', { name: 'Item 2' })).toBeChecked()
  })
})
