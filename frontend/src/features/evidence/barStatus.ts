// Pure rules for the slim evidence bar on the audit page. No store access, no mutation.
import { currentItemLabel } from './appState'
import type { PickItem } from './appState'
import type { RunSource, RunView } from './types'
import { isRunActive } from './useItemRun'

export type BarTone = 'neutral' | 'amber' | 'blue' | 'emerald' | 'rose'
/** Whether the chosen source has what a run needs. */
export type SetupState = 'loading' | 'needed' | 'ready'

export interface BarStatus {
  tone: BarTone
  text: string
  running: boolean
}

export interface BarInput {
  locked: boolean
  /** The latest run of any status. */
  run: RunView | null
  /** The latest completed or partial run. */
  resultRun: RunView | null
  suggestionCount: number
  flaggedCount: number
  items: readonly PickItem[]
  setup: SetupState
}

/** Shown on the bar (behind an info button) and at the top of the drawer. */
export const SUGGESTIONS_NOTE = 'Suggestions only. Nothing changes your answers or the score until you accept or override it.'

/** The short name of each source, as the bar shows it. */
export const SOURCE_LABEL: Record<RunSource, string> = { app: 'App', repo: 'Code repository', pages: 'Public pages' }

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** One line on what a running run is doing. Worded apart from the drawer's progress block. */
export function runningText(run: RunView, items: readonly PickItem[]): string {
  if (run.status === 'queued') return 'Waiting to start'
  if (run.source === 'pages') {
    return run.status === 'capturing'
      ? `Reading pages · ${run.pagesDone} of ${run.pagesTotal}`
      : `Assessing categories · ${run.categoriesDone} of ${run.categoriesTotal}`
  }
  if (run.source === 'repo' && run.status === 'capturing') return 'Reading the repository'
  const total = run.categoriesTotal
  if (total <= 0) return 'Starting'
  const position = Math.min(run.categoriesDone + 1, total)
  // Item texts are often sentences: their full stop would sit before the "·".
  const label = currentItemLabel(run, items)?.replace(/[.\s]+$/, '')
  return label ? `Checking ${label} · ${position} of ${total}` : `Checking item ${position} of ${total}`
}

/** What the bar says. A running run wins, then the lock, a failure, the last result and the set-up. */
export function barStatus(input: BarInput): BarStatus {
  const { run, resultRun } = input
  if (run && isRunActive(run)) return { tone: 'blue', text: runningText(run, input.items), running: true }
  const last = resultRun ? `Last run: ${plural(input.suggestionCount, 'suggestion')} · ${input.flaggedCount} flagged` : null
  if (input.locked) return { tone: 'neutral', text: last ? `Audit locked · ${last}` : 'Audit locked · no new runs', running: false }
  if (run?.status === 'failed' && run.id !== resultRun?.id) return { tone: 'rose', text: 'Last run failed', running: false }
  if (last) return { tone: 'neutral', text: last, running: false }
  if (input.setup === 'loading') return { tone: 'neutral', text: 'Loading…', running: false }
  if (input.setup === 'needed') return { tone: 'amber', text: 'Needs setup', running: false }
  return { tone: 'emerald', text: 'Ready', running: false }
}
