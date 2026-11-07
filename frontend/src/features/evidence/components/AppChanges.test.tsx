import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AppChangeView } from '../types'
import AppChanges from './AppChanges'

const change = (over: Partial<AppChangeView> = {}): AppChangeView => ({
  id: 'c-1',
  itemId: 'i1',
  accountLabel: 'Teen 15',
  pageUrl: 'https://social.example.test/settings/privacy?token=redacted',
  control: 'Private account',
  before: 'on',
  after: 'off',
  restored: false,
  restoreDetail: null,
  ...over,
})

describe('AppChanges', () => {
  it('shows the page path, not the host or the query', () => {
    render(<AppChanges changes={[change()]} />)
    const row = screen.getByText(/Private account/)
    expect(row).toHaveTextContent('on /settings/privacy is off (was on).')
    expect(row.textContent).not.toContain('social.example.test')
    expect(row.textContent).not.toContain('token')
  })

  it('keeps a value that is not a URL as it is', () => {
    render(<AppChanges changes={[change({ pageUrl: '/settings' })]} />)
    expect(screen.getByText(/Private account/)).toHaveTextContent('on /settings is off')
  })
})
