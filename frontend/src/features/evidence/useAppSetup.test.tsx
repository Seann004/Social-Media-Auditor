import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/useStore'
import * as api from './api'
import { EvidenceApiError } from './api'
import type { AppSetupResponse } from './types'
import { useAppSetup } from './useAppSetup'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, getAppSetup: vi.fn() }
})
const getAppSetup = vi.mocked(api.getAppSetup)

const setup = (n: number): AppSetupResponse => ({
  app: { appUrl: `https://app${n}.example`, loginDomains: [], updatedAt: '2026-11-04T09:00:00.000Z' },
  accounts: [],
  secretKeyConfigured: true,
})

beforeEach(() => {
  getAppSetup.mockReset()
  useStore.setState({ authToken: 'tok' })
})
afterEach(() => useStore.setState({ authToken: null }))

describe('useAppSetup', () => {
  it('loads, then reloads on demand', async () => {
    getAppSetup.mockResolvedValueOnce(setup(1)).mockResolvedValueOnce(setup(2))
    const { result } = renderHook(() => useAppSetup('p1', { enabled: true }))
    expect(result.current.loading).toBe(true)
    await act(async () => {})
    expect(result.current.loading).toBe(false)
    expect(result.current.setup?.app?.appUrl).toBe('https://app1.example')
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.setup?.app?.appUrl).toBe('https://app2.example')
    expect(getAppSetup).toHaveBeenCalledTimes(2)
  })

  it('makes no request when disabled', async () => {
    const { result } = renderHook(() => useAppSetup('p1', { enabled: false }))
    await act(async () => {
      await result.current.reload()
    })
    expect(getAppSetup).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.setup).toBeNull()
  })

  it.each([401, 403, 503])('stops loading and surfaces a %i as the error', async (status) => {
    getAppSetup.mockRejectedValue(new EvidenceApiError(status, 'nope'))
    const { result } = renderHook(() => useAppSetup('p1', { enabled: true }))
    await act(async () => {})
    expect(result.current.loading).toBe(false)
    expect(result.current.error?.status).toBe(status)
    expect(result.current.setup).toBeNull()
    expect(getAppSetup).toHaveBeenCalledTimes(1)
  })

  it('wraps a network failure as a status 0 error', async () => {
    getAppSetup.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useAppSetup('p1', { enabled: true }))
    await act(async () => {})
    expect(result.current.error?.status).toBe(0)
  })
})
