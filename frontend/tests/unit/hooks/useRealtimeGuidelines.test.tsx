import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type InsertHandler = (payload: { new: Record<string, unknown> }) => Promise<void>

const { supabase, channel, fetchGuidelineItems } = vi.hoisted(() => {
  const channel = {
    handler: null as InsertHandler | null,
    filter: null as unknown,
    on: vi.fn(),
    subscribe: vi.fn(),
  }
  channel.on.mockImplementation((_type: string, filter: unknown, handler: InsertHandler) => {
    channel.filter = filter
    channel.handler = handler
    return channel
  })
  channel.subscribe.mockImplementation(() => channel)
  const supabase = { channel: vi.fn(() => channel), removeChannel: vi.fn() }
  return { supabase, channel, fetchGuidelineItems: vi.fn() }
})

vi.mock('../../../src/lib/supabase', () => ({ supabase }))
vi.mock('../../../src/lib/db', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/db')>()),
  fetchGuidelineItems,
}))

import { useStore } from '../../../src/store/useStore'
import { useRealtimeGuidelines } from '../../../src/hooks/useRealtimeGuidelines'

const RAW = { guidelineId: 'g9', guidelineName: 'New Framework', shortName: 'NF', isDeleted: false }
const ITEM = { itemId: 'i9', guidelineId: 'g9', category: 'Cat', itemDescription: 'Do X', severity: 'major' }

beforeEach(() => {
  localStorage.clear()
  supabase.channel.mockClear()
  supabase.removeChannel.mockClear()
  channel.handler = null
  fetchGuidelineItems.mockReset().mockResolvedValue([ITEM])
  useStore.setState({ guidelines: [], checklistItems: [] } as never)
})

describe('useRealtimeGuidelines', () => {
  it('subscribes to guideline inserts and removes the channel on unmount', () => {
    const { unmount } = renderHook(() => useRealtimeGuidelines())
    expect(supabase.channel).toHaveBeenCalledWith('guideline-inserts')
    expect(channel.filter).toEqual({ event: 'INSERT', schema: 'public', table: 'Guideline' })
    expect(channel.subscribe).toHaveBeenCalled()
    unmount()
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel)
  })

  it('adds a new global guideline with its items to the store', async () => {
    renderHook(() => useRealtimeGuidelines())
    await act(async () => { await channel.handler!({ new: RAW }) })
    expect(fetchGuidelineItems).toHaveBeenCalledWith('g9')
    const { guidelines, checklistItems } = useStore.getState()
    expect(guidelines).toEqual([expect.objectContaining({ id: 'g9', name: 'New Framework', shortName: 'NF', itemCount: 1 })])
    expect(checklistItems).toEqual([expect.objectContaining({ id: 'i9', text: 'Do X', category: 'Cat' })])
  })

  it('does not add the same guideline twice', async () => {
    renderHook(() => useRealtimeGuidelines())
    await act(async () => { await channel.handler!({ new: RAW }) })
    await act(async () => { await channel.handler!({ new: RAW }) })
    expect(useStore.getState().guidelines).toHaveLength(1)
  })

  it.each([
    ['a project-scoped copy', { ...RAW, projectId: 'p1' }],
    ['a deleted guideline', { ...RAW, isDeleted: true }],
  ])('ignores %s', async (_name, raw) => {
    renderHook(() => useRealtimeGuidelines())
    await act(async () => { await channel.handler!({ new: raw }) })
    expect(fetchGuidelineItems).not.toHaveBeenCalled()
    expect(useStore.getState().guidelines).toEqual([])
  })

  it('logs and adds nothing when the items cannot be loaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchGuidelineItems.mockRejectedValue(new Error('offline'))
    renderHook(() => useRealtimeGuidelines())
    await act(async () => { await channel.handler!({ new: RAW }) })
    await waitFor(() => expect(error).toHaveBeenCalledWith('Failed to load new guideline from realtime event', expect.any(Error)))
    expect(useStore.getState().guidelines).toEqual([])
    error.mockRestore()
  })
})
