import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import type { DbGuideline } from '../lib/db'
import { fetchGuidelineItems } from '../lib/db'

export function useRealtimeGuidelines() {
  const addGuidelineFromRealtime = useStore((s) => s.addGuidelineFromRealtime)

  useEffect(() => {
    const channel = supabase
      .channel('guideline-inserts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'Guideline' },
        async (payload) => {
          const raw = payload.new as DbGuideline & { projectId?: string | null }
          // Project-scoped copies (cloned when guidelines are attached to a project) are
          // inserted into the same table; they are not global frameworks and must not be
          // merged into the shared guideline list (duplicates, cross-project leakage).
          if (raw.projectId || raw.isDeleted) return
          try {
            const items = await fetchGuidelineItems(raw.guidelineId)
            addGuidelineFromRealtime(raw, items)
          } catch (err) {
            console.error('Failed to load new guideline from realtime event', err)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [addGuidelineFromRealtime])
}
