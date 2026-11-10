import { describe, it, expect, vi, afterEach } from 'vitest'
import { SUPABASE_NETWORK_RETRY_DELAYS_MS } from './config.js'
import { dbInsert, dbCall, isDbNetworkFailure } from './supabaseRetry.js'

/** What supabase-js returns when fetch itself threw: status 0 and no Postgres code. */
const networkFailure = () => ({
  data: null,
  error: { message: 'TypeError: fetch failed', details: 'TypeError: fetch failed\n\nCaused by: Error: read ECONNRESET (ECONNRESET)', hint: '', code: '' },
  status: 0,
})
const aborted = () => ({
  data: null,
  error: { message: 'AbortError: This operation was aborted', details: '', hint: 'Request was aborted (timeout or manual cancellation)', code: '' },
  status: 0,
})
const duplicate = () => ({
  data: null,
  error: { message: 'duplicate key value violates unique constraint', details: '', hint: '', code: '23505' },
  status: 409,
})
const ok = (data: unknown) => ({ data, error: null, status: 201 })
const NO_WAIT = [0, 0]

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('isDbNetworkFailure', () => {
  it('is true only for a failure supabase-js reports from fetch itself', () => {
    expect(isDbNetworkFailure(networkFailure())).toBe(true)
    expect(isDbNetworkFailure(duplicate())).toBe(false)
    expect(isDbNetworkFailure(aborted())).toBe(false)
    expect(isDbNetworkFailure(ok({}))).toBe(false)
    // A test stand-in with no status is not a network failure.
    expect(isDbNetworkFailure({ data: null, error: { message: 'boom' } })).toBe(false)
  })
  it('is true for a storage failure whose original error is a network failure', () => {
    const original = new TypeError('fetch failed')
    expect(isDbNetworkFailure({ data: null, error: { name: 'StorageUnknownError', message: 'fetch failed', originalError: original } })).toBe(true)
  })
})

describe('dbCall', () => {
  it('waits about 1 s and then 3 s between tries', () => {
    expect(SUPABASE_NETWORK_RETRY_DELAYS_MS).toEqual([1_000, 3_000])
  })
  it('retries a network failure and returns the later success', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = vi.fn().mockResolvedValueOnce(networkFailure()).mockResolvedValueOnce(networkFailure()).mockResolvedValue(ok({ id: 'r1' }))
    expect(await dbCall('updateRun', run, NO_WAIT)).toEqual(ok({ id: 'r1' }))
    expect(run).toHaveBeenCalledTimes(3)
    expect(log).toHaveBeenCalledTimes(2)
    expect(String(log.mock.calls[0][0])).toContain('updateRun')
  })
  it('uses the waits in config by default', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = vi.fn().mockResolvedValueOnce(networkFailure()).mockResolvedValue(ok({ id: 'r1' }))
    const p = dbCall('updateRun', run)
    await vi.advanceTimersByTimeAsync(SUPABASE_NETWORK_RETRY_DELAYS_MS[0] - 1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await p).data).toEqual({ id: 'r1' })
  })
  it('returns the last network failure after two retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = vi.fn().mockResolvedValue(networkFailure())
    expect((await dbCall('updateRun', run, NO_WAIT)).error?.message).toBe('TypeError: fetch failed')
    expect(run).toHaveBeenCalledTimes(3)
  })
  it('does not retry an error Postgres returned', async () => {
    const run = vi.fn().mockResolvedValue(duplicate())
    expect(await dbCall('updateRun', run, NO_WAIT)).toEqual(duplicate())
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('does not retry an aborted request', async () => {
    const run = vi.fn().mockResolvedValue(aborted())
    await dbCall('updateRun', run, NO_WAIT)
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('retries a thrown network error and rethrows any other error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const flaky = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue(ok(1))
    expect((await dbCall('upload', flaky, NO_WAIT)).data).toBe(1)
    const broken = vi.fn().mockRejectedValue(new Error('bug'))
    await expect(dbCall('upload', broken, NO_WAIT)).rejects.toThrow('bug')
    expect(broken).toHaveBeenCalledTimes(1)
  })
})

describe('dbInsert', () => {
  it('reads the row back when a retry finds the first try was saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const insert = vi.fn().mockResolvedValueOnce(networkFailure()).mockResolvedValue(duplicate())
    const readBack = vi.fn().mockResolvedValue(ok({ id: 's1' }))
    expect(await dbInsert('addSuggestion', insert, readBack, NO_WAIT)).toEqual(ok({ id: 's1' }))
    expect(insert).toHaveBeenCalledTimes(2)
    expect(readBack).toHaveBeenCalledTimes(1)
  })
  it('returns a duplicate as is when no try failed on the network', async () => {
    const insert = vi.fn().mockResolvedValue(duplicate())
    const readBack = vi.fn()
    expect(await dbInsert('addSuggestion', insert, readBack, NO_WAIT)).toEqual(duplicate())
    expect(readBack).not.toHaveBeenCalled()
  })
  it('keeps the duplicate when reading back finds no row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const insert = vi.fn().mockResolvedValueOnce(networkFailure()).mockResolvedValue(duplicate())
    const readBack = vi.fn().mockResolvedValue(ok(null))
    expect(await dbInsert('addSuggestion', insert, readBack, NO_WAIT)).toEqual(duplicate())
  })
})
