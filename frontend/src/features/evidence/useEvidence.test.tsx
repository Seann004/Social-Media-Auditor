import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { EvidenceApiError } from './api'
import { makeDecision, makePage, makeRun, makeSuggestion } from './testFixtures'
import { useEvidence } from './useEvidence'
import type { LatestRunResponse, SuggestionsResponse } from './types'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, getLatestRun: vi.fn(), getSuggestions: vi.fn() }
})

const getLatestRun = vi.mocked(api.getLatestRun)
const getSuggestions = vi.mocked(api.getSuggestions)

const active = (status: 'queued' | 'capturing' | 'assessing' = 'capturing') =>
  makeRun({ id: 'run-2', status, finishedAt: null })
const latest = (run: ReturnType<typeof makeRun> | null): LatestRunResponse => ({ run, pages: run ? [makePage()] : [] })
const results = (): SuggestionsResponse => ({ run: null, suggestions: [], decisions: [] })
const sugg = (): SuggestionsResponse => ({
  run: makeRun(),
  suggestions: [makeSuggestion({ itemId: 'a' }), makeSuggestion({ id: 's-2', itemId: 'b' })],
  decisions: [makeDecision({ itemId: 'a' })],
})

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  getLatestRun.mockReset()
  getSuggestions.mockReset()
  getSuggestions.mockResolvedValue(sugg())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useEvidence', () => {
  it('loads the latest run and the suggestions, keyed by item', async () => {
    getLatestRun.mockResolvedValue(latest(makeRun()))
    const { result } = renderHook(() => useEvidence('p1', { enabled: true }))
    expect(result.current.loading).toBe(true)
    await settle()
    expect(result.current.loading).toBe(false)
    expect(result.current.run?.id).toBe('run-1')
    expect([...result.current.suggestionsByItem.keys()]).toEqual(['a', 'b'])
    expect([...result.current.decisionsByItem.keys()]).toEqual(['a'])
    expect(result.current.resultRun?.id).toBe('run-1')
    expect(result.current.error).toBeNull()
  })

  it('sends nothing when disabled', async () => {
    const { result } = renderHook(() => useEvidence('p1', { enabled: false }))
    await tick(10_000)
    expect(getLatestRun).not.toHaveBeenCalled()
    expect(getSuggestions).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('polls every 3 seconds while the run is active, never overlapping', async () => {
    const slow = deferred<LatestRunResponse>()
    getLatestRun.mockResolvedValueOnce(latest(active())).mockReturnValueOnce(slow.promise)
    renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    expect(getLatestRun).toHaveBeenCalledTimes(1)
    await tick(3000)
    expect(getLatestRun).toHaveBeenCalledTimes(2)
    await tick(20_000) // the second poll has not answered: no third call
    expect(getLatestRun).toHaveBeenCalledTimes(2)
    getLatestRun.mockResolvedValue(latest(active('assessing')))
    await act(async () => { slow.resolve(latest(active('assessing'))) })
    await tick(2999)
    expect(getLatestRun).toHaveBeenCalledTimes(2)
    await tick(1)
    expect(getLatestRun).toHaveBeenCalledTimes(3)
  })

  it('refreshes suggestions once when the run finishes, then stops polling', async () => {
    getLatestRun.mockResolvedValueOnce(latest(active())).mockResolvedValue(latest(makeRun({ id: 'run-2' })))
    renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    expect(getSuggestions).toHaveBeenCalledTimes(1)
    await tick(3000)
    expect(getSuggestions).toHaveBeenCalledTimes(2)
    await tick(30_000)
    expect(getLatestRun).toHaveBeenCalledTimes(2)
    expect(getSuggestions).toHaveBeenCalledTimes(2)
  })

  it('treats a poll answering failed (stale sweep) as finished', async () => {
    getLatestRun
      .mockResolvedValueOnce(latest(active('queued')))
      .mockResolvedValue(latest(makeRun({ id: 'run-2', status: 'failed', error: 'Server restarted' })))
    const { result } = renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    await tick(3000)
    expect(result.current.run?.status).toBe('failed')
    expect(getSuggestions).toHaveBeenCalledTimes(2)
    await tick(30_000)
    expect(getLatestRun).toHaveBeenCalledTimes(2)
  })

  it('stops polling on unmount and ignores an answer that arrives later', async () => {
    const slow = deferred<LatestRunResponse>()
    getLatestRun.mockResolvedValueOnce(latest(active())).mockReturnValueOnce(slow.promise)
    const { unmount } = renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    await tick(3000)
    unmount()
    await act(async () => { slow.resolve(latest(makeRun())) })
    await tick(30_000)
    expect(getLatestRun).toHaveBeenCalledTimes(2)
    expect(getSuggestions).toHaveBeenCalledTimes(1)
  })

  it('ignores a late answer for the previous project after projectId changes', async () => {
    const slowA = deferred<LatestRunResponse>()
    getLatestRun.mockReturnValueOnce(slowA.promise)
    getLatestRun.mockResolvedValueOnce(latest(makeRun({ id: 'run-B', projectId: 'pB' })))
    const { result, rerender } = renderHook(({ id }) => useEvidence(id, { enabled: true }), {
      initialProps: { id: 'pA' },
    })
    await settle()
    rerender({ id: 'pB' })
    await settle()
    expect(result.current.run?.id).toBe('run-B')
    await act(async () => { slowA.resolve(latest(makeRun({ id: 'run-A', projectId: 'pA' }))) })
    await settle()
    expect(result.current.run?.id).toBe('run-B')
    expect(getLatestRun.mock.calls.map((c) => c[0])).toEqual(['pA', 'pB'])
  })

  it('keeps polling through a 500 and shows an error only after several failures in a row', async () => {
    getLatestRun
      .mockResolvedValueOnce(latest(active()))
      .mockRejectedValue(new EvidenceApiError(500, 'Something went wrong on the server.'))
    const { result } = renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    await tick(3000)
    expect(result.current.error).toBeNull()
    await tick(3000)
    expect(result.current.error).toBeNull()
    await tick(3000)
    expect(result.current.error?.status).toBe(500)
    expect(getLatestRun.mock.calls.length).toBeGreaterThanOrEqual(4)
    getLatestRun.mockResolvedValue(latest(active()))
    await tick(3000)
    expect(result.current.error).toBeNull()
  })

  it('stops polling on a 401 and reports it', async () => {
    getLatestRun
      .mockResolvedValueOnce(latest(active()))
      .mockRejectedValue(new EvidenceApiError(401, 'expired'))
    const { result } = renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    await tick(3000)
    expect(result.current.error?.status).toBe(401)
    await tick(30_000)
    expect(getLatestRun).toHaveBeenCalledTimes(2)
  })

  it('keeps the older summary when the latest call fails', async () => {
    getLatestRun.mockResolvedValueOnce(latest(makeRun())).mockRejectedValue(new EvidenceApiError(500, 'x'))
    const { result } = renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    await act(async () => { await result.current.refresh() })
    expect(result.current.error?.status).toBe(500)
    expect(result.current.suggestionsByItem.size).toBe(2)
    expect(result.current.resultRun?.id).toBe('run-1')
  })

  it('shares one request among refresh calls made while one is in flight', async () => {
    getLatestRun.mockResolvedValueOnce(latest(makeRun()))
    const { result } = renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    const slow = deferred<LatestRunResponse>()
    getLatestRun.mockReturnValueOnce(slow.promise)
    let all: Promise<unknown[]> = Promise.resolve([])
    act(() => { all = Promise.all([result.current.refresh(), result.current.refresh(), result.current.refresh()]) })
    await act(async () => { slow.resolve(latest(makeRun())); await all })
    expect(getLatestRun).toHaveBeenCalledTimes(2)
  })

  it('rebuilds the maps instead of mutating them', async () => {
    getLatestRun.mockResolvedValue(latest(makeRun()))
    const { result } = renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    const before = result.current.suggestionsByItem
    await act(async () => { await result.current.refresh() })
    expect(result.current.suggestionsByItem).not.toBe(before)
    expect(before.size).toBe(2)
  })
  it('keeps retrying the suggestions after a run finishes, showing an error after several failures', async () => {
    getLatestRun.mockResolvedValueOnce(latest(active())).mockResolvedValue(latest(makeRun({ id: 'run-2' })))
    getSuggestions
      .mockResolvedValueOnce(results())
      .mockRejectedValueOnce(new EvidenceApiError(500, 'x'))
      .mockRejectedValueOnce(new EvidenceApiError(500, 'x'))
      .mockRejectedValueOnce(new EvidenceApiError(500, 'x'))
      .mockResolvedValue(sugg())
    const { result } = renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    await tick(3000)
    await tick(3000)
    expect(result.current.error).toBeNull()
    await tick(3000)
    expect(result.current.error?.status).toBe(500)
    expect(result.current.suggestionsByItem.size).toBe(0)
    await tick(3000)
    expect(result.current.error).toBeNull()
    expect(result.current.suggestionsByItem.size).toBe(2)
    const calls = getSuggestions.mock.calls.length
    await tick(30_000)
    expect(getSuggestions.mock.calls.length).toBe(calls)
  })

  it('does not poll while a refresh is in flight', async () => {
    getLatestRun.mockResolvedValueOnce(latest(active()))
    const { result } = renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    const slow = deferred<LatestRunResponse>()
    getLatestRun.mockReturnValueOnce(slow.promise)
    let pending: Promise<void> = Promise.resolve()
    act(() => { pending = result.current.refresh() })
    await tick(10_000) // the poll timer fires meanwhile
    expect(getLatestRun).toHaveBeenCalledTimes(2)
    getLatestRun.mockResolvedValue(latest(active()))
    await act(async () => { slow.resolve(latest(active())); await pending })
  })

  it('waits for an in-flight poll before a refresh starts its own requests', async () => {
    const slow = deferred<LatestRunResponse>()
    getLatestRun.mockResolvedValueOnce(latest(active())).mockReturnValueOnce(slow.promise)
    const { result } = renderHook(() => useEvidence('p1', { enabled: true }))
    await settle()
    await tick(3000) // poll in flight
    let pending: Promise<void> = Promise.resolve()
    act(() => { pending = result.current.refresh() })
    await settle()
    expect(getLatestRun).toHaveBeenCalledTimes(2)
    getLatestRun.mockResolvedValue(latest(active()))
    await act(async () => { slow.resolve(latest(active())); await pending })
    expect(getLatestRun).toHaveBeenCalledTimes(3)
  })
})
