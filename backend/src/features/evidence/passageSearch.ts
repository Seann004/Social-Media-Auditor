import { createHash } from 'node:crypto'
import { cosine, type Embedder } from '../../lib/embedder.js'
import { pickCandidates } from '../../services/mappingCandidates.js'
import { logRunProblem, type RunCtx } from './runnerShared.js'
import type { Passage } from './types.js'

/** How many passages each of the two searches (words, meaning) hands to the merge. */
export const HYBRID_POOL = 15
/**
 * The lowest cosine of a passage and the question that counts as close in meaning. A starting value for a small
 * English model, where unrelated texts usually score 0.4 to 0.5; tune it against the page benchmark.
 */
export const MIN_PASSAGE_SIMILARITY = 0.55
/** bge models search best when the question carries this prefix; the passages do not. */
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '
const CACHE_LIMIT = 20_000

/** Vectors by model and text, kept while the server runs, so a re-assess does not ask the service again for the same passage. */
const vectorCache = new Map<string, number[]>()
const cacheKey = (model: string, text: string): string => `${model}|${createHash('sha1').update(text).digest('hex')}`

/** The passages of the pages the AI may read, once per run. */
const runPassages = new WeakMap<object, Promise<Passage[]>>()

async function passagesOfRun(ctx: RunCtx): Promise<Passage[]> {
  const known = runPassages.get(ctx)
  if (known) return known
  const loading = (async () => {
    const pages = await ctx.deps.repo.listPages(ctx.run.capturedInRunId)
    return ctx.deps.repo.listPassagesOfPages(pages.filter((p) => p.accessStatus === 'ok').map((p) => p.id))
  })()
  runPassages.set(ctx, loading)
  loading.catch(() => runPassages.delete(ctx))
  return loading
}

async function vectorsFor(embedder: Embedder, texts: readonly string[], signal: AbortSignal): Promise<number[][]> {
  const missing = [...new Set(texts.filter((t) => !vectorCache.has(cacheKey(embedder.model, t))))]
  if (missing.length > 0) {
    const made = await embedder.embed(missing, signal)
    if (vectorCache.size + missing.length > CACHE_LIMIT) vectorCache.clear()
    missing.forEach((t, i) => vectorCache.set(cacheKey(embedder.model, t), made[i]))
  }
  return texts.map((t) => vectorCache.get(cacheKey(embedder.model, t)) as number[])
}

async function closeInMeaning(ctx: RunCtx, embedder: Embedder, query: string): Promise<Passage[]> {
  const all = await passagesOfRun(ctx)
  if (all.length === 0) return []
  const [question] = await vectorsFor(embedder, [`${QUERY_PREFIX}${query}`], ctx.signal)
  const vectors = await vectorsFor(embedder, all.map((p) => p.text), ctx.signal)
  return all
    .map((p, i) => ({ p, score: cosine(question, vectors[i]) }))
    .filter((x) => x.score >= MIN_PASSAGE_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, HYBRID_POOL)
    .map((x) => x.p)
}

/**
 * The passages to show the AI for one item. With no embedder this is the keyword search as it always was. With one,
 * the keyword hits and the passages closest in meaning are merged, so a page that says the same thing in other
 * words can still be found. If the embedding service fails, the keyword hits are used and the problem is logged.
 */
export async function searchForItem(ctx: RunCtx, query: string, limit: number): Promise<Passage[]> {
  const { repo, embedder } = ctx.deps
  if (!embedder) return repo.searchPassages(ctx.run.capturedInRunId, query, limit)
  const byWords = await repo.searchPassages(ctx.run.capturedInRunId, query, Math.max(limit, HYBRID_POOL))
  let byMeaning: Passage[] = []
  try {
    byMeaning = await closeInMeaning(ctx, embedder, query)
  } catch (err) {
    if (ctx.signal.aborted) throw err
    logRunProblem(ctx, 'Could not search the passages by meaning, so only the keyword search is used', err)
    return byWords.slice(0, limit)
  }
  const byId = new Map([...byWords, ...byMeaning].map((p) => [p.id, p]))
  const rank = (list: Passage[]) => list.map((p, at) => ({ id: p.id, score: list.length - at }))
  return pickCandidates(rank(byWords), rank(byMeaning), limit).map((id) => byId.get(id) as Passage)
}

/** For tests: forgets the vectors kept in memory. */
export function clearVectorCache(): void {
  vectorCache.clear()
}
