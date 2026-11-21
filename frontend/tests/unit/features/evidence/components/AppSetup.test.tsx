import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../../../../src/features/evidence/api'
import type { AppSetupResponse } from '../../../../../src/features/evidence/types'
import AppSetup from '../../../../../src/features/evidence/components/AppSetup'

vi.mock('../../../../../src/features/evidence/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../../src/features/evidence/api')>()), saveAppSource: vi.fn() }))
const saveAppSource = vi.mocked(api.saveAppSource)

const setup: AppSetupResponse = {
  app: { appUrl: 'https://app.example', loginDomains: [], updatedAt: '2026-11-04T09:00:00.000Z' },
  accounts: [],
  secretKeyConfigured: true,
}

beforeEach(() => {
  saveAppSource.mockReset().mockResolvedValue({ app: { appUrl: 'https://app.example', loginDomains: [], updatedAt: '2026-11-11T09:00:00.000Z' } })
})

describe('AppSetup: test account rows', () => {
  const accounts: AppSetupResponse['accounts'] = [
    { id: 'a1', label: 'Teen 15', ageGroup: 'under_18', age: 15, loginName: 'teen.login@example.test', handles: [], hasPassword: true, updatedAt: '' },
    { id: 'a2', label: 'Grown-up', ageGroup: 'adult', age: null, loginName: 'adult.login@example.test', handles: [], hasPassword: true, updatedAt: '' },
  ]

  it('shows an initial badge, the name, an age pill, the muted login and a "Password saved" chip', () => {
    render(<AppSetup projectId="p1" setup={{ ...setup, accounts }} onSaved={vi.fn()} />)
    const teen = screen.getByText('Teen 15').closest('li')!
    expect(within(teen).getByText('T')).toHaveAttribute('aria-hidden', 'true')
    expect(within(teen).getByText('Under 18 (15)').className).toMatch(/\brounded-full\b/)
    expect(within(teen).getByText('teen.login@example.test').className).toMatch(/\btext-slate-500\b/)
    expect(within(teen).getByText('Password saved').className).toMatch(/\brounded-full\b/)
    expect(within(teen).getByRole('button', { name: 'Edit Teen 15' })).toBeInTheDocument()
    expect(within(teen).getByRole('button', { name: 'Remove Teen 15' })).toBeInTheDocument()
    // Without an age, the pill gives the group alone.
    const adult = screen.getByText('Grown-up').closest('li')!
    expect(within(adult).getByText('Adult').className).toMatch(/\brounded-full\b/)
  })

  it('makes "Add test account" a dashed button with a plus icon', () => {
    render(<AppSetup projectId="p1" setup={setup} onSaved={vi.fn()} />)
    const add = screen.getByRole('button', { name: 'Add test account' })
    expect(add.className).toMatch(/\bborder-dashed\b/)
    expect(add.querySelector('svg')).not.toBeNull()
  })
})

describe('AppSetup: the saved note', () => {
  it('shows "Saved" only once the panel has reloaded after the save', async () => {
    const user = userEvent.setup()
    render(<AppSetup projectId="p1" setup={setup} onSaved={vi.fn().mockResolvedValue(undefined)} />)
    await user.click(screen.getByRole('button', { name: /save app address/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved: https://app.example')
  })

  it('never shows "Saved" next to an error when the reload after the save fails', async () => {
    const user = userEvent.setup()
    render(<AppSetup projectId="p1" setup={setup} onSaved={vi.fn().mockRejectedValue(new Error('reload failed'))} />)
    await user.click(screen.getByRole('button', { name: /save app address/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
