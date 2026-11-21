export interface Scored {
  id: string
  score: number
}

/** The usual constant of reciprocal rank fusion: a larger value makes the two lists count more evenly. */
const RRF_K = 60

/**
 * Chooses the candidates to show the AI for one item from two ranked lists: by shared words (`lexical`) and by
 * closeness in meaning (`semantic`, null when there are no vectors). Each list is already filtered to what
 * counts as a hit. An item that ranks well in both lists comes first, and an item only one list finds can still get in.
 * With no semantic list the result is the lexical list as it was.
 */
export function pickCandidates(lexical: readonly Scored[], semantic: readonly Scored[] | null, limit: number): string[] {
  const byLexical = [...lexical].sort((a, b) => b.score - a.score)
  if (semantic === null) return byLexical.slice(0, limit).map((s) => s.id)
  const bySemantic = [...semantic].sort((a, b) => b.score - a.score)
  const fused = new Map<string, number>()
  for (const list of [byLexical, bySemantic]) {
    list.forEach((s, rank) => fused.set(s.id, (fused.get(s.id) ?? 0) + 1 / (RRF_K + rank + 1)))
  }
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id)
}
