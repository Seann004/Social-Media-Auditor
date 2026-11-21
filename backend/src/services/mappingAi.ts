import { groqFetchWithRetry } from '../lib/groq.js'
import { recordAiUsage } from '../lib/aiUsage.js'
import { retryOnNetworkFailure } from '../features/evidence/networkRetry.js'
import { resolveMappingModel } from './mappingService.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

/** Waits before each extra try when the connection to Groq itself fails (a connect time-out, a reset). Each try can take 10 s to time out. */
export const MAPPING_NETWORK_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000]

/** Groq's rate-limit waits are honoured up to this long. A longer one (a daily limit can ask for 20 minutes or more) fails the batch at once instead of holding the check for hours. */
export const MAX_RATE_LIMIT_WAIT_SECONDS = 90

interface GroqReply {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/** Reply cap for one matching call: 8 items with a few matches each, with room to spare. */
export const MAPPING_MAX_OUTPUT_TOKENS = 1_500
const REASONING_MODEL_PREFIX = 'openai/gpt-oss'
/** Groq's 400 code when JSON mode is on and the model's output is not valid JSON. */
const JSON_VALIDATE_FAILED = 'json_validate_failed'

/** One request. A json_validate_failed 400 comes back as an empty reply, like unreadable JSON. */
async function requestOnce(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<GroqReply> {
  const response = await groqFetchWithRetry(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: MAPPING_MAX_OUTPUT_TOKENS,
      ...(model.startsWith(REASONING_MODEL_PREFIX) ? { reasoning_effort: 'low' } : {}),
    }),
  }, 3, MAX_RATE_LIMIT_WAIT_SECONDS)
  if (!response.ok) {
    const text = await response.text()
    if (response.status === 400 && text.includes(JSON_VALIDATE_FAILED)) return {}
    throw new Error(`Groq API error: ${text}`)
  }
  return (await response.json()) as GroqReply
}

function parseReply(data: GroqReply): unknown | null {
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') return null
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Sends one matching prompt to Groq and returns its parsed JSON reply. A failure of the network itself is
 * tried again after short waits; an HTTP error is not. A reply that is not valid JSON is asked for once more.
 * Throws when the key is missing, Groq answers with an error, or the reply is unreadable twice.
 */
export async function askMappingModel(
  systemPrompt: string,
  userPrompt: string,
  env: Record<string, string | undefined> = process.env,
  delaysMs: readonly number[] = MAPPING_NETWORK_RETRY_DELAYS_MS,
): Promise<unknown> {
  const apiKey = env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured on the backend server')
  const model = resolveMappingModel(env)

  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await retryOnNetworkFailure(
      () => requestOnce(apiKey, model, systemPrompt, userPrompt),
      { label: `matching call (model ${model})`, delaysMs },
    )
    recordAiUsage('matching', model, data.usage)
    const parsed = parseReply(data)
    if (parsed !== null) return parsed
  }
  throw new Error('Groq returned invalid JSON twice')
}
