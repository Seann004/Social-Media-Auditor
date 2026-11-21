/**
 * A short-lived cache for the ranked review list, so paging and filtering do not reload every pair, item and
 * project each time. Anything that writes to Item_Mapping calls `invalidateMappingCache`.
 */
const TTL_MS = 15_000

let entry: { at: number; value: Promise<unknown> } | null = null

export function invalidateMappingCache(): void {
  entry = null
}

export function cachedRanking<T>(load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  if (entry && now - entry.at < TTL_MS) return entry.value as Promise<T>
  const value = load()
  const created = { at: now, value }
  entry = created
  // A failed load must not be served again.
  value.catch(() => { if (entry === created) entry = null })
  return value
}
