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

  describe('guideline headings', () => {
    const guidelines = [
      { id: 'g1', name: 'Demo Child Safety Checklist', shortName: 'DEMO', version: '1.0' },
      { id: 'g2', name: 'Online Safety Code', shortName: 'OSC', version: '2.1' },
    ]
    const two: ChecklistItem[] = [
      { ...item(1, 'Privacy'), guidelineId: 'g1' },
      { ...item(2, 'Reporting'), guidelineId: 'g2' },
      { ...item(3, 'Safety'), guidelineId: 'g1' },
    ]

    function WithGuidelines({ all, known }: { all: ChecklistItem[]; known?: typeof guidelines }) {
      const [picked, setPicked] = useState<Set<string>>(new Set())
      return <AppItemPicker items={toPickItems(all)} picked={picked} onChange={setPicked} guidelines={known} />
    }

    it('names each guideline with its short name and version above its categories, in checklist order', () => {
      render(<WithGuidelines all={two} known={guidelines} />)
      const headings = screen.getAllByRole('heading', { level: 4 })
      expect(headings.map((h) => h.textContent)).toEqual(['Demo Child Safety Checklist · DEMO v1.0', 'Online Safety Code · OSC v2.1'])
    })

    it('keeps every category under the guideline it belongs to, even when guidelines interleave', () => {
      render(<WithGuidelines all={two} known={guidelines} />)
      const first = screen.getByRole('heading', { name: /Demo Child Safety Checklist/ }).closest('section')!
      expect(within(first).getByRole('button', { name: 'Privacy' })).toBeInTheDocument()
      expect(within(first).getByRole('button', { name: 'Safety' })).toBeInTheDocument()
      expect(within(first).queryByRole('button', { name: 'Reporting' })).toBeNull()
    })

    it('shows a count of items per guideline', () => {
      render(<WithGuidelines all={two} known={guidelines} />)
      const first = screen.getByRole('heading', { name: /Demo Child Safety Checklist/ }).closest('section')!
      expect(within(first).getByText('2 items')).toBeInTheDocument()
    })

    it('shows no heading when the guideline is not known', () => {
      render(<WithGuidelines all={two} known={[]} />)
      expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0)
      expect(screen.getByRole('checkbox', { name: 'Item 1' })).toBeInTheDocument()
    })
  })

  describe('evidence kind chips', () => {
    const TEXTS = {
      app: 'Accounts of users under 16 are private by default.',
      neither: 'The privacy policy for younger users is easy to find.',
      code: 'Passwords are stored hashed, never in plain text.',
      both: 'Users must enter their date of birth when they sign up.',
    }
    const kinds: ChecklistItem[] = Object.values(TEXTS).map((text, n) => ({ ...item(n + 1, 'Privacy by default'), itemName: undefined, text }))

    function WithSource({ source }: { source?: 'app' | 'repo' }) {
      const [picked, setPicked] = useState<Set<string>>(new Set())
      return <AppItemPicker items={toPickItems(kinds)} picked={picked} onChange={setPicked} guidelines={[]} source={source} />
    }
    const rowOf = (text: string) => screen.getByRole('checkbox', { name: text }).closest('li')!

    it('shows a chip with the suggested kind beside each item, with the reason as a tooltip and for screen readers', () => {
      render(<WithSource />)
      const chips: [string, string][] = [
        [TEXTS.app, 'App'],
        [TEXTS.neither, 'Policy / process'],
        [TEXTS.code, 'Code'],
        [TEXTS.both, 'App + Code'],
      ]
      for (const [text, label] of chips) expect(within(rowOf(text)).getByText(label)).toBeInTheDocument()
      const chip = within(rowOf(TEXTS.neither)).getByText('Policy / process')
      expect(chip).toHaveAttribute('title', 'It is a policy or process item (it mentions “policy”).')
      expect(chip).toHaveTextContent('Suggested source: Policy / process. It is a policy or process item (it mentions “policy”).')
      expect(within(chip).getByText('. It is a policy or process item (it mentions “policy”).')).toHaveClass('sr-only')
    })

    it('keeps each checkbox named by its item text alone', () => {
      render(<WithSource source="app" />)
      for (const text of Object.values(TEXTS)) {
        const box = screen.getByRole('checkbox', { name: text })
        expect(box).toHaveAccessibleName(text)
        expect(box).toBeEnabled()
      }
    })

    it('on the App source, marks the items that suit another source, and blocks none of them', async () => {
      const user = userEvent.setup()
      render(<WithSource source="app" />)
      expect(within(rowOf(TEXTS.code)).getByText('Better checked with Code')).toBeInTheDocument()
      expect(within(rowOf(TEXTS.neither)).getByText("Usually can't be shown by an app or code")).toBeInTheDocument()
      expect(within(rowOf(TEXTS.app)).queryByText(/Better checked|Usually can't/)).toBeNull()
      expect(within(rowOf(TEXTS.both)).queryByText(/Better checked|Usually can't/)).toBeNull()
      await user.click(screen.getByRole('checkbox', { name: TEXTS.code }))
      await user.click(screen.getByRole('checkbox', { name: TEXTS.neither }))
      expect(screen.getByText(`2 of ${MAX_APP_ITEMS} picked`)).toBeInTheDocument()
    })

    it('on the Code repository source, points app items to the App', () => {
      render(<WithSource source="repo" />)
      expect(within(rowOf(TEXTS.app)).getByText('Better checked with the App')).toBeInTheDocument()
      expect(within(rowOf(TEXTS.neither)).getByText("Usually can't be shown by an app or code")).toBeInTheDocument()
      expect(within(rowOf(TEXTS.code)).queryByText(/Better checked|Usually can't/)).toBeNull()
      expect(within(rowOf(TEXTS.both)).queryByText(/Better checked|Usually can't/)).toBeNull()
    })

    it('shows no hint without a source', () => {
      render(<WithSource />)
      expect(screen.queryByText(/Better checked|Usually can't/)).toBeNull()
    })
  })

  describe('select all per category', () => {
    const three = (limit?: number) => {
      const all = [
        { ...item(1, 'Privacy'), guidelineId: 'g1' },
        { ...item(2, 'Privacy'), guidelineId: 'g1' },
        { ...item(3, 'Safety'), guidelineId: 'g1' },
        { ...item(4, 'Safety'), guidelineId: 'g1' },
      ]
      function Wrapper() {
        const [picked, setPicked] = useState<Set<string>>(new Set())
        return <AppItemPicker items={toPickItems(all)} picked={picked} onChange={setPicked} limit={limit} guidelines={[]} />
      }
      return render(<Wrapper />)
    }

    it('picks every item of that category only, and leaves the other category alone', async () => {
      const user = userEvent.setup()
      three()
      await user.click(screen.getByRole('button', { name: 'Select all in Privacy' }))
      expect(screen.getByRole('checkbox', { name: 'Item 1' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Item 2' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Item 3' })).not.toBeChecked()
      expect(screen.getByText(`2 of ${MAX_APP_ITEMS} picked`)).toBeInTheDocument()
    })

    it('turns into Clear once the whole category is picked, and clears only that category', async () => {
      const user = userEvent.setup()
      three()
      await user.click(screen.getByRole('button', { name: 'Select all in Privacy' }))
      await user.click(screen.getByRole('button', { name: 'Select all in Safety' }))
      expect(screen.queryByRole('button', { name: 'Select all in Privacy' })).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Clear Privacy' }))
      expect(screen.getByRole('checkbox', { name: 'Item 1' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Item 3' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Item 4' })).toBeChecked()
    })

    it('stops at the limit, in checklist order, and is disabled when nothing more fits', async () => {
      const user = userEvent.setup()
      three(3)
      await user.click(screen.getByRole('button', { name: 'Select all in Privacy' }))
      await user.click(screen.getByRole('button', { name: 'Select all in Safety' }))
      expect(screen.getByRole('checkbox', { name: 'Item 3' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Item 4' })).not.toBeChecked()
      expect(screen.getByText('3 of 3 picked')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Select all in Safety' })).toBeDisabled()
    })

    it('does not fold the category when the button is pressed', async () => {
      const user = userEvent.setup()
      three()
      await user.click(screen.getByRole('button', { name: 'Select all in Privacy' }))
      expect(screen.getByRole('checkbox', { name: 'Item 1' })).toBeVisible()
    })
  })
})
