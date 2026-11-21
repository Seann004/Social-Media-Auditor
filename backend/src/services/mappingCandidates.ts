export interface Scored {
  id: string
  score: number
}

/**
 * Chooses the candidates to show the AI for one item from two ranked lists: by shared words (`lexical`) and by
 * closeness in meaning (`semantic`, null when there are no vectors). Each list is already filtered to what
 * counts as a hit. The two are taken in turn, best of each first, meaning first, skipping what is already chosen, so
 * both always get slots. (An earlier merge by combined rank let strong word hits push out the right partner, which
 * the meaning search ranked 1st to 4th: see docs/testing/benchmarks.) With no semantic list the result is the lexical list.
 */
export function pickCandidates(lexical: readonly Scored[], semantic: readonly Scored[] | null, limit: number): string[] {
  const byLexical = [...lexical].sort((a, b) => b.score - a.score)
  if (semantic === null) return byLexical.slice(0, limit).map((s) => s.id)
  const bySemantic = [...semantic].sort((a, b) => b.score - a.score)
  const chosen: string[] = []
  const seen = new Set<string>()
  for (let rank = 0; chosen.length < limit && (rank < bySemantic.length || rank < byLexical.length); rank++) {
    for (const list of [bySemantic, byLexical]) {
      const entry = list[rank]
      if (entry && !seen.has(entry.id) && chosen.length < limit) {
        seen.add(entry.id)
        chosen.push(entry.id)
      }
    }
  }
  return chosen
}
