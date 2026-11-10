import { groqFetchWithRetry } from '../../lib/groq.js'
import { AI_REASONING_EFFORT, AI_TEMPERATURE, GROQ_MAX_WAIT_MS, GROQ_NETWORK_RETRY_DELAYS_MS } from './config.js'
import { retryOnNetworkFailure } from './networkRetry.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const REASONING_MODEL_PREFIX = 'openai/gpt-oss'

export interface GroqJsonOptions {
  apiKey: string
  model: string
  system: string
  user: string
  maxTokens: number
  /** Ends the call, and any wait for a retry, when it aborts. */
  signal?: AbortSignal
}

export interface GroqJsonResult {
  /** The parsed JSON reply, or null when the reply was not JSON. */
  content: unknown | null
  tokens: number
}

interface GroqBody {
  choices?: { message?: { content?: string } }[]
  usage?: { total_tokens?: number }
}

/**
 * One JSON-mode Groq call. A daily limit surfaces as GroqLimitError; other failures throw with the status only.
 * A failure of the network itself (no HTTP status) is tried again after short waits; an HTTP error never is,
 * apart from the 429 waits inside groqFetchWithRetry.
 */
export async function callGroqJson(opts: GroqJsonOptions): Promise<GroqJsonResult> {
  const body = await retryOnNetworkFailure(() => requestOnce(opts), {
    label: `Groq call (model ${opts.model})`,
    delaysMs: GROQ_NETWORK_RETRY_DELAYS_MS,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  })
  const tokens = body.usage?.total_tokens ?? 0
  const text = body.choices?.[0]?.message?.content
  if (typeof text !== 'string') return { content: null, tokens }
  try {
    return { content: JSON.parse(text) as unknown, tokens }
  } catch {
    return { content: null, tokens }
  }
}

/** One request and its body. Reading the body is inside, so a connection that breaks mid-reply is retried too. */
async function requestOnce(opts: GroqJsonOptions): Promise<GroqBody> {
  const res = await groqFetchWithRetry(
    GROQ_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        temperature: AI_TEMPERATURE,
        max_tokens: opts.maxTokens,
        response_format: { type: 'json_object' },
        ...(opts.model.startsWith(REASONING_MODEL_PREFIX) ? { reasoning_effort: AI_REASONING_EFFORT } : {}),
      }),
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    },
    3,
    GROQ_MAX_WAIT_MS / 1000,
  )
  if (!res.ok) throw new Error(`Groq request failed with status ${res.status}`)
  return (await res.json()) as GroqBody
}
