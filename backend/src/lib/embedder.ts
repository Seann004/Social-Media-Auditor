/**
 * Turns texts into vectors so that items worded differently can still be found as close in meaning.
 * Providers: Google's Gemini embedding API (free key from Google AI Studio) and Hugging Face's Inference API.
 * Without a key there is no embedder (null) and every caller falls back to word matching, so the feature is optional.
 */
import { wait } from './groq.js'

export type EmbedPurpose = 'document' | 'query'

export interface Embedder {
  /** Identifies the vectors: vectors of different models are never compared or mixed. */
  readonly model: string
  /** Text some models want in front of a search question (not in front of the passages). */
  readonly queryPrefix?: string
  /** One unit-length vector per text, in order. Throws when the provider fails. */
  embed(texts: readonly string[], signal?: AbortSignal, purpose?: EmbedPurpose): Promise<number[][]>
}

type Env = Record<string, string | undefined>

const HF_DEFAULT_MODEL = 'BAAI/bge-small-en-v1.5'
const HF_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '
const GEMINI_DEFAULT_MODEL = 'gemini-embedding-001'
/** The model gives 3072 numbers by default; a shorter vector is far cheaper to store and compare and loses little. */
const GEMINI_DEFAULT_DIMENSIONS = 768
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
/** The most texts Gemini takes in one batch request. */
const GEMINI_MAX_BATCH = 100
const DEFAULT_BATCH_SIZE = 32
const DEFAULT_RETRY_WAIT_MS = 5_000
const RETRIES = 3
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

function wholeNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback
}

function isVectorList(value: unknown, count: number): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every((v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && Number.isFinite(x)))
  )
}

interface Call {
  url: string
  headers: Record<string, string>
  body: unknown
  signal: AbortSignal | undefined
  /** Statuses that mean "try again in a moment". */
  retryOn: readonly number[]
  retryWaitMs: number
}

/** One request, tried again a few times on a busy or loading answer. Only the status is ever in an error: a body can echo the key. */
async function post(call: Call): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(call.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...call.headers },
      body: JSON.stringify(call.body),
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    })
    if (call.retryOn.includes(res.status) && attempt < RETRIES) {
      await wait(call.retryWaitMs * (attempt + 1), call.signal)
      continue
    }
    if (!res.ok) throw new Error(`Embedding request failed with status ${res.status}`)
    return res.json()
  }
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function createGeminiEmbedder(env: Env, key: string): Embedder {
  const name = env.EMBEDDING_MODEL?.trim() || GEMINI_DEFAULT_MODEL
  const dimensions = Math.max(1, wholeNumber(env.EMBEDDING_DIMENSIONS, GEMINI_DEFAULT_DIMENSIONS))
  const batchSize = Math.min(GEMINI_MAX_BATCH, Math.max(1, wholeNumber(env.EMBEDDING_BATCH_SIZE, GEMINI_MAX_BATCH)))
  const retryWaitMs = wholeNumber(env.EMBEDDING_RETRY_WAIT_MS, DEFAULT_RETRY_WAIT_MS)
  const base = env.GEMINI_EMBEDDING_URL?.trim() || `${GEMINI_BASE_URL}/models/${name}:batchEmbedContents`

  return {
    model: `${name}@${dimensions}`,
    async embed(texts, signal, purpose = 'document') {
      const out: number[][] = []
      for (const part of chunks(texts, batchSize)) {
        const body = {
          requests: part.map((text) => ({
            model: `models/${name}`,
            content: { parts: [{ text: text.slice(0, MAX_TEXT_CHARS) }] },
            taskType: purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
            outputDimensionality: dimensions,
          })),
        }
        // The key goes in a header, never in the address, so it is not in any log line that prints the address.
        const reply = (await post({ url: base, headers: { 'x-goog-api-key': key }, body, signal, retryOn: [429, 500, 503], retryWaitMs })) as {
          embeddings?: { values?: unknown }[]
        }
        const vectors = (reply.embeddings ?? []).map((e) => e.values)
        if (!isVectorList(vectors, part.length)) throw new Error('The embedding service returned an unexpected reply')
        // A shortened vector is no longer unit length.
        out.push(...vectors.map(normalise))
      }
      return out
    },
  }
}

function createHuggingFaceEmbedder(env: Env, token: string): Embedder {
  const model = env.EMBEDDING_MODEL?.trim() || HF_DEFAULT_MODEL
  const url = env.HF_EMBEDDING_URL?.trim() || `https://router.huggingface.co/hf-inference/models/${model}/pipeline/feature-extraction`
  const batchSize = Math.max(1, wholeNumber(env.EMBEDDING_BATCH_SIZE, DEFAULT_BATCH_SIZE))
  const retryWaitMs = wholeNumber(env.EMBEDDING_RETRY_WAIT_MS, DEFAULT_RETRY_WAIT_MS)

  return {
    model,
    queryPrefix: HF_QUERY_PREFIX,
    async embed(texts, signal) {
      const out: number[][] = []
      for (const part of chunks(texts, batchSize)) {
        const body = { inputs: part.map((t) => t.slice(0, MAX_TEXT_CHARS)), options: { wait_for_model: true } }
        const reply = await post({ url, headers: { Authorization: `Bearer ${token}` }, body, signal, retryOn: [503], retryWaitMs })
        if (!isVectorList(reply, part.length)) throw new Error('The embedding service returned an unexpected reply')
        out.push(...reply.map(normalise))
      }
      return out
    },
  }
}

/**
 * The embedder the environment asks for, or null when there is none (no key, or EMBEDDINGS=off).
 * GEMINI_API_KEY wins over HF_API_TOKEN when both are set.
 */
export function createEmbedder(env: Env = process.env): Embedder | null {
  if (env.EMBEDDINGS === 'off') return null
  const gemini = env.GEMINI_API_KEY?.trim()
  if (gemini) return createGeminiEmbedder(env, gemini)
  const hf = env.HF_API_TOKEN?.trim()
  if (hf) return createHuggingFaceEmbedder(env, hf)
  return null
}
