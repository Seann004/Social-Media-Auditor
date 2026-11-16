// How the screen speaks about an item's kind: the chip's label and the better-source line. Pure.
import type { EvidenceKind } from './types'

/** The sources the kind is shown for: the App and the Code repository. */
export type CheckSource = 'app' | 'repo'

/** The chip shown beside an item in the picker. */
export const KIND_LABEL: Readonly<Record<EvidenceKind, string>> = {
  app: 'App',
  code: 'Code',
  both: 'App + Code',
  neither: 'Policy / process',
}

/** Whether the source is one the kind suits. */
export function fitsSource(kind: EvidenceKind, source: CheckSource): boolean {
  if (kind === 'both') return true
  if (kind === 'neither') return false
  return (kind === 'app') === (source === 'app')
}

/** The muted line under an item that suits another source, or null when the source suits it. */
export function betterSourceHint(kind: EvidenceKind, source: CheckSource): string | null {
  if (fitsSource(kind, source)) return null
  if (kind === 'neither') return "Usually can't be shown by an app or code"
  return kind === 'code' ? 'Better checked with Code' : 'Better checked with the App'
}
