import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import type { AppSetupResponse } from '../types'
import AppSetup from './AppSetup'

vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), saveAppSource: vi.fn() }))
const saveAppSource = vi.mocked(api.saveAppSource)

const setup: AppSetupResponse = {
  app: { appUrl: 'https://app.example', loginDomains: [], updatedAt: '2026-11-04T09:00:00.000Z' },
  accounts: [],
  secretKeyConfigured: true,
}

beforeEach(() => {
  saveAppSource.mockReset().mockResolvedValue({ app: { appUrl: 'https://app.example', loginDomains: [], updatedAt: '2026-11-11T09:00:00.000Z' } })
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
