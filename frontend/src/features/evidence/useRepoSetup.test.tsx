import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/useStore'
import * as api from './api'
import { EvidenceApiError } from './api'
import { useRepoSetup } from './useRepoSetup'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, getRepoSource: vi.fn(), saveRepoSource: vi.fn() }
})
const getRepoSource = vi.mocked(api.getRepoSource)
const saveRepoSource = vi.mocked(api.saveRepoSource)

const repo = { repoUrl: 'https://github.com/o/n', branch: null, updatedAt: '2026-11-07T09:00:00.000Z' }

beforeEach(() => {
  getRepoSource.mockReset()
  saveRepoSource.mockReset()
  useStore.setState({ sessionToken: 'tok' })
})
afterEach(() => useStore.setState({ sessionToken: null }))

describe('useRepoSetup', () => {
  it('loads the saved repository', async () => {
    getRepoSource.mockResolvedValue({ repo })
    const { result } = renderHook(() => useRepoSetup('p1', { enabled: true }))
    expect(result.current.state).toBe('loading')
    await act(async () => {})
    expect(result.current.state).toBe('ok')
    expect(result.current.repo).toEqual(repo)
  })

  it('makes no request when disabled', async () => {
    const { result } = renderHook(() => useRepoSetup('p1', { enabled: false }))
    await act(async () => {})
    expect(getRepoSource).not.toHaveBeenCalled()
    expect(result.current.repo).toBeNull()
  })

  it('reports a load failure as error', async () => {
    getRepoSource.mockRejectedValue(new EvidenceApiError(503, 'down'))
    const { result } = renderHook(() => useRepoSetup('p1', { enabled: true }))
    await act(async () => {})
    expect(result.current.state).toBe('error')
  })

  it('save returns null and keeps the new repository', async () => {
    getRepoSource.mockResolvedValue({ repo: null })
    saveRepoSource.mockResolvedValue({ repo })
    const { result } = renderHook(() => useRepoSetup('p1', { enabled: true }))
    await act(async () => {})
    let outcome: string | null = 'unset'
    await act(async () => {
      outcome = await result.current.save({ repoUrl: repo.repoUrl, branch: null })
    })
    expect(outcome).toBeNull()
    expect(saveRepoSource).toHaveBeenCalledWith('p1', { repoUrl: repo.repoUrl, branch: null })
    expect(result.current.repo).toEqual(repo)
  })

  it('save returns the server sentence on a refusal and keeps the old repository', async () => {
    getRepoSource.mockResolvedValue({ repo })
    saveRepoSource.mockRejectedValue(new EvidenceApiError(400, "That branch name isn't valid."))
    const { result } = renderHook(() => useRepoSetup('p1', { enabled: true }))
    await act(async () => {})
    let outcome: string | null = null
    await act(async () => {
      outcome = await result.current.save({ repoUrl: 'x', branch: 'bad..' })
    })
    expect(outcome).toBe("That branch name isn't valid.")
    expect(result.current.repo).toEqual(repo)
  })
})
