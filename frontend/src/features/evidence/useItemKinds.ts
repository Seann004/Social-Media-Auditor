// The AI's kind of each checklist item, asked for once per project and kept for the browser session.
// The drawer asks when it first opens; the audit page's cards read the same answer without asking.
import { useEffect, useSyncExternalStore } from 'react'
import { getItemKinds } from './api'
import type { EvidenceKind, ItemKindView } from './types'

export type ItemKindsStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface ItemKindsState {
  status: ItemKindsStatus
  /** Only high-confidence kinds, by item id. Empty unless ready: no hint while loading or after a failure. */
  kinds: ReadonlyMap<string, ItemKindView>
}

type Entry = { status: 'loading' } | { status: 'ready'; kinds: ReadonlyMap<string, ItemKindView> } | { status: 'failed' }

const KINDS: readonly EvidenceKind[] = ['app', 'code', 'both', 'neither']
const NO_KINDS: ReadonlyMap<string, ItemKindView> = new Map()

let entries: ReadonlyMap<string, Entry> = new Map()
/** Bumped by forgetItemKinds, so an answer to an earlier request is dropped. */
let generation = 0
const listeners = new Set<() => void>()

function setEntry(projectId: string, entry: Entry): void {
  entries = new Map(entries).set(projectId, entry)
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The server's reply, checked: an entry of any other shape is left out. */
function readKinds(reply: unknown): ReadonlyMap<string, ItemKindView> {
  const raw = typeof reply === 'object' && reply !== null ? (reply as { kinds?: unknown }).kinds : null
  if (typeof raw !== 'object' || raw === null) return NO_KINDS
  const kinds = Object.entries(raw).flatMap(([id, value]): [string, ItemKindView][] => {
    const { kind, reason } = (typeof value === 'object' && value !== null ? value : {}) as { kind?: unknown; reason?: unknown }
    return KINDS.includes(kind as EvidenceKind) && typeof reason === 'string' ? [[id, { kind: kind as EvidenceKind, reason }]] : []
  })
  return new Map(kinds)
}

function load(projectId: string): void {
  const asked = generation
  setEntry(projectId, { status: 'loading' })
  getItemKinds(projectId)
    .then((reply) => {
      if (asked === generation) setEntry(projectId, { status: 'ready', kinds: readKinds(reply) })
    })
    .catch(() => {
      // No hint is the safe answer: the picker and the cards stay as they were.
      if (asked === generation) setEntry(projectId, { status: 'failed' })
    })
}

/** Forgets every project's kinds (for tests). */
export function forgetItemKinds(): void {
  generation += 1
  entries = new Map()
  listeners.forEach((listener) => listener())
}

/**
 * The project's item kinds. When `enabled`, it asks the server once, unless the kinds are already
 * here or on their way; after a failure it asks again the next time it is enabled. With `enabled`
 * false it only reads what another caller asked for.
 */
export function useItemKinds(projectId: string, enabled: boolean): ItemKindsState {
  const entry = useSyncExternalStore(subscribe, () => entries.get(projectId))
  useEffect(() => {
    if (!enabled || projectId === '') return
    const current = entries.get(projectId)
    if (current === undefined || current.status === 'failed') load(projectId)
  }, [projectId, enabled])
  if (entry === undefined) return { status: 'idle', kinds: NO_KINDS }
  return entry.status === 'ready' ? { status: 'ready', kinds: entry.kinds } : { status: entry.status, kinds: NO_KINDS }
}
