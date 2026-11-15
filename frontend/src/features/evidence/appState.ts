// Pure rules for the "check inside the app" panel. No store access, no mutation.
import type { ChecklistItem, Severity } from '../../types'
import { suggestEvidenceKind, type EvidenceKindSuggestion } from './evidenceKind'
import { categoryKey } from './state'
import type { AppSetupResponse, AppStepOutcome, RunView } from './types'

/** Mirrors APP_MAX_STEPS_PER_CHECK in backend/src/features/evidence/config.ts. */
export const APP_STEPS_PER_CHECK = 15
/** Mirrors the backend's per-run item limit. */
export const MAX_APP_ITEMS = 10
/** Shown above the item picker: each item costs AI tokens. */
export const PICK_TIP = "About 3 items works best on Groq's free plan"

/** Everything an app run needs from set-up: an address, an account and the server's key. */
export const isAppSetupComplete = (setup: AppSetupResponse): boolean =>
  setup.app !== null && setup.accounts.length > 0 && setup.secretKeyConfigured

export const OUTCOME_LABEL: Record<AppStepOutcome, string> = {
  done: 'Done',
  refused: 'Refused',
  failed: 'Failed',
  blocked: 'Stopped',
}

export interface PickItem {
  id: string
  guidelineId: string
  category: string
  label: string
  /** The item code, such as "P-1", when the guideline has one. */
  code?: string
  /** Shown as a chip in the picker; left out when the value is not one the app knows. */
  severity?: Severity
  /** The source that can most likely answer the item, shown as a chip in the picker. */
  evidenceKind?: EvidenceKindSuggestion
}

const SEVERITIES: readonly Severity[] = ['critical', 'major', 'minor']
const isSeverity = (value: unknown): value is Severity => SEVERITIES.includes(value as Severity)

export function toPickItems(items: readonly ChecklistItem[]): PickItem[] {
  return items.map((item) => ({
    id: item.id,
    guidelineId: item.guidelineId,
    category: item.category,
    label: item.itemName ?? item.text,
    code: item.itemCode || undefined,
    severity: isSeverity(item.severity) ? item.severity : undefined,
    evidenceKind: suggestEvidenceKind(item),
  }))
}

export interface PickGroup {
  key: string
  guidelineId: string
  category: string
  items: PickItem[]
}

/** Items grouped by guideline and category, in the order they first appear. */
export function groupPickItems(items: readonly PickItem[]): PickGroup[] {
  const groups = new Map<string, PickGroup>()
  for (const item of items) {
    const key = categoryKey(item.guidelineId, item.category)
    const group = groups.get(key)
    if (group) groups.set(key, { ...group, items: [...group.items, item] })
    else groups.set(key, { key, guidelineId: item.guidelineId, category: item.category, items: [item] })
  }
  return [...groups.values()]
}

export interface PickSection {
  guidelineId: string
  /** How many items the guideline has in this list. */
  itemCount: number
  groups: PickGroup[]
}

/** The category groups gathered under their guideline, in the order each guideline first appears. */
export function groupPickItemsByGuideline(items: readonly PickItem[]): PickSection[] {
  const sections = new Map<string, PickSection>()
  for (const group of groupPickItems(items)) {
    const section = sections.get(group.guidelineId)
    if (section) {
      sections.set(group.guidelineId, { ...section, itemCount: section.itemCount + group.items.length, groups: [...section.groups, group] })
    } else {
      sections.set(group.guidelineId, { guidelineId: group.guidelineId, itemCount: group.items.length, groups: [group] })
    }
  }
  return [...sections.values()]
}

/** What the picker needs to name a guideline. */
export interface GuidelineLabel {
  id: string
  name: string
  shortName: string
  version: string
}

/** "Name · SHORT vX", leaving out what the guideline does not have. */
export function guidelineTitle(guideline: GuidelineLabel): string {
  const tag = [guideline.shortName, guideline.version ? `v${guideline.version}` : ''].filter(Boolean).join(' ')
  return tag ? `${guideline.name} · ${tag}` : guideline.name
}

export interface AppRunBlockerInput {
  hasApp: boolean
  accountCount: number
  picked: number
  secretKeyConfigured: boolean
  locked: boolean
  running: boolean
}

/** The sentence saying why a run cannot start, or null when it can. The earliest applicable one wins. */
export function appRunBlocker(input: AppRunBlockerInput): string | null {
  if (input.locked) return 'This audit is locked, so no runs can start.'
  if (input.running) return 'A run is already in progress.'
  if (!input.secretKeyConfigured) return "Checking inside the app isn't set up on the server yet."
  if (!input.hasApp) return 'Save the app address first.'
  if (input.accountCount === 0) return 'Add at least one test account.'
  if (input.picked === 0) return 'Pick at least one item.'
  if (input.picked > MAX_APP_ITEMS) return `Pick at most ${MAX_APP_ITEMS} items.`
  return null
}

/** The label of the item the run is checking now, or null when none or unknown. */
export function currentItemLabel(run: RunView, items: readonly PickItem[]): string | null {
  if (run.currentItemId === null) return null
  return items.find((item) => item.id === run.currentItemId)?.label ?? null
}
