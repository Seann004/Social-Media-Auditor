import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../../../src/store/useStore'
import * as api from '../../../../src/features/evidence/api'
import { EvidenceApiError } from '../../../../src/features/evidence/api'
import { forgetItemKinds, useItemKinds } from '../../../../src/features/evidence/useItemKinds'

vi.mock('../../../../src/features/evidence/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../src/features/evidence/api')>()), getItemKinds: vi.fn() }))
const getItemKinds = vi.mocked(api.getItemKinds)

const KINDS = { kinds: { i1: { kind: 'code' as const, reason: 'Only the server shows it.' } } }

beforeEach(() => {
  forgetItemKinds()
  getItemKinds.mockReset()
  useStore.setState({ authToken: 'tok' })
})
afterEach(() => useStore.setState({ authToken: null }))

describe('useItemKinds', () => {
  it('asks nothing until it is enabled, and shows no kinds meanwhile', async () => {
    const { result } = renderHook(() => useItemKinds('p1', false))
    await act(async () => {})
    expect(getItemKinds).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(result.current.kinds.size).toBe(0)
  })

  it('loads once when enabled: no kinds while loading, then the kinds by item id', async () => {
    let answer: (value: typeof KINDS) => void = () => undefined
    getItemKinds.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => useItemKinds('p1', true))
    expect(result.current.status).toBe('loading')
    expect(result.current.kinds.size).toBe(0)
    await act(async () => answer(KINDS))
    expect(result.current.status).toBe('ready')
    expect(result.current.kinds.get('i1')).toEqual({ kind: 'code', reason: 'Only the server shows it.' })
    expect(getItemKinds).toHaveBeenCalledWith('p1')
  })

  it('keeps the kinds for the session: a reopened drawer and another reader ask nothing', async () => {
    getItemKinds.mockResolvedValue(KINDS)
    const first = renderHook(({ enabled }) => useItemKinds('p1', enabled), { initialProps: { enabled: true } })
    await act(async () => {})
    first.rerender({ enabled: false })
    first.rerender({ enabled: true })
    first.unmount()
    const page = renderHook(() => useItemKinds('p1', false))
    await act(async () => {})
    expect(getItemKinds).toHaveBeenCalledTimes(1)
    expect(page.result.current.kinds.get('i1')?.kind).toBe('code')
  })

  it('shows no kinds when the call fails, and tries again when it is enabled again', async () => {
    getItemKinds.mockRejectedValueOnce(new EvidenceApiError(503, 'down')).mockResolvedValueOnce(KINDS)
    const { result, rerender } = renderHook(({ enabled }) => useItemKinds('p1', enabled), { initialProps: { enabled: true } })
    await act(async () => {})
    expect(result.current.status).toBe('failed')
    expect(result.current.kinds.size).toBe(0)
    rerender({ enabled: false })
    rerender({ enabled: true })
    await act(async () => {})
    expect(result.current.status).toBe('ready')
    expect(getItemKinds).toHaveBeenCalledTimes(2)
  })

  it('leaves out an entry the server sent in an unexpected shape', async () => {
    getItemKinds.mockResolvedValue({ kinds: { i1: { kind: 'app', reason: 'Seen in the app.' }, i2: { kind: 'maybe', reason: 'x' }, i3: { kind: 'code' } } } as never)
    const { result } = renderHook(() => useItemKinds('p1', true))
    await act(async () => {})
    expect([...result.current.kinds.keys()]).toEqual(['i1'])
  })

  it('keeps projects apart', async () => {
    getItemKinds.mockResolvedValue(KINDS)
    renderHook(() => useItemKinds('p1', true))
    await act(async () => {})
    const other = renderHook(() => useItemKinds('p2', false))
    expect(other.result.current.status).toBe('idle')
  })
})
