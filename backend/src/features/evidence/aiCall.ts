import { groqFetchWithRetry } from '../../lib/groq.js'
import { AI_REASONING_EFFORT, AI_TEMPERATURE, GROQ_MAX_WAIT_MS } from './config.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const REASONING_MODEL_PREFIX = 'openai/gpt-oss'

export interface GroqJsonOptions {
  apiKey: string
  model: string
  system: string
  user: string
  maxTokens: number
}

export interface GroqJsonResult {
  /** The parsed JSON reply, or null when the reply was not JSON. */
  content: unknown | null
  tokens: number
}

/** One JSON-mode Groq call. A daily limit surfaces as GroqLimitError; other failures throw with the status only. */
export async function callGroqJson(opts: GroqJsonOptions): Promise<GroqJsonResult> {
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
    },
    3,
    GROQ_MAX_WAIT_MS / 1000,
  )
  if (!res.ok) throw new Error(`Groq request failed with status ${res.status}`)
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: { total_tokens?: number }
  }
  const tokens = body.usage?.total_tokens ?? 0
  const text = body.choices?.[0]?.message?.content
  if (typeof text !== 'string') return { content: null, tokens }
  try {
    return { content: JSON.parse(text) as unknown, tokens }
  } catch {
    return { content: null, tokens }
  }
}
