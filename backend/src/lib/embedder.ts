/**
 * Turns texts into vectors so that items worded differently can still be found as close in meaning.
 * The default provider is Hugging Face's free Inference API with a small open model. Without a token there is
 * no embedder (null) and every caller falls back to word matching, so the feature is optional.
 */
import { wait } from './groq.js'

export interface Embedder {
  /** Identifies the vectors: vectors of different models are never compared or mixed. */
  readonly model: string
  /** One unit-length vector per text, in order. Throws when the provider fails. */
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>
}

const DEFAULT_MODEL = 'BAAI/bge-small-en-v1.5'
const DEFAULT_BATCH_SIZE = 32
const DEFAULT_RETRY_WAIT_MS = 5_000
const MODEL_LOADING_RETRIES = 3
/** Texts are cut here before sending: a requirement or a passage never needs more for its meaning. */
const MAX_TEXT_CHARS = 2_000

export function normalise(vector: readonly number[]): number[] {
  const length = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0))
  return length === 0 ? [...vector] : vector.map((x) => x / length)
}

/** Cosine similarity. Different lengths (vectors of different models) are never similar. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let la = 0
  let lb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    la += a[i] * a[i]
    lb += b[i] * b[i]
  }
  return la === 0 || lb === 0 ? 0 : dot / Math.sqrt(la * lb)
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && raw !== undefined && raw.trim() !== '' ? n : fallback
}

function isVectorList(value: unknown, count: number): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every((v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && Number.isFinite(x)))
  )
}

/** The embedder the environment asks for, or null when there is none (no token, or EMBEDDINGS=off). */
export function createEmbedder(env: Record<string, string | undefined> = process.env): Embedder | null {
  const token = env.HF_API_TOKEN?.trim()
  if (!token || env.EMBEDDINGS === 'off') return null
  const model = env.EMBEDDING_MODEL?.trim() || DEFAULT_MODEL
  const url = env.HF_EMBEDDING_URL?.trim() || `https://router.huggingface.co/hf-inference/models/${model}/pipeline/feature-extraction`
  const batchSize = Math.max(1, positiveInt(env.EMBEDDING_BATCH_SIZE, DEFAULT_BATCH_SIZE))
  const retryWaitMs = positiveInt(env.EMBEDDING_RETRY_WAIT_MS, DEFAULT_RETRY_WAIT_MS)

  async function embedBatch(texts: string[], signal: AbortSignal | undefined): Promise<number[][]> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ inputs: texts.map((t) => t.slice(0, MAX_TEXT_CHARS)), options: { wait_for_model: true } }),
        ...(signal === undefined ? {} : { signal }),
      })
      // 503 means the model is still loading on the free tier: wait, then ask again.
      if (res.status === 503 && attempt < MODEL_LOADING_RETRIES) {
        await wait(retryWaitMs, signal)
        continue
      }
      // Status only: the body of an error can echo the request, and the request holds the token.
      if (!res.ok) throw new Error(`Embedding request failed with status ${res.status}`)
      const body: unknown = await res.json()
      if (!isVectorList(body, texts.length)) throw new Error('The embedding service returned an unexpected reply')
      return body.map(normalise)
    }
  }

  return {
    model,
    async embed(texts, signal) {
      const out: number[][] = []
      for (let i = 0; i < texts.length; i += batchSize) {
        out.push(...(await embedBatch(texts.slice(i, i + batchSize) as string[], signal)))
      }
      return out
    },
  }
}
