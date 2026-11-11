import type { TestAccount } from './appTypes.js'

/** Label order for test accounts: case-insensitive, with the raw label breaking ties. Not left to the database collation. */
export function byLabel(a: Pick<TestAccount, 'label'>, b: Pick<TestAccount, 'label'>): number {
  const base = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  if (base !== 0) return base
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
}
