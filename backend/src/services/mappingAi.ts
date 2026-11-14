import { groqFetchWithRetry } from '../lib/groq.js'
import { recordAiUsage } from '../lib/aiUsage.js'
import { retryOnNetworkFailure } from '../features/evidence/networkRetry.js'
import { resolveMappingModel } from './mappingService.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

/** Waits before each extra try when the connection to Groq itself fails (a connect time-out, a reset). Each try can take 10 s to time out. */
export const MAPPING_NETWORK_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000]

interface GroqReply {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * Sends one matching prompt to Groq and returns its parsed JSON reply. A failure of the network itself is
 * tried again after short waits; an HTTP error is not. Throws when the key is missing or Groq answers with an error.
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

  const data = await retryOnNetworkFailure(async () => {
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
      }),
    })
    if (!response.ok) throw new Error(`Groq API error: ${await response.text()}`)
    return (await response.json()) as GroqReply
  }, { label: `matching call (model ${model})`, delaysMs })

  recordAiUsage('matching', model, data.usage)
  return JSON.parse(data.choices?.[0]?.message?.content || '{}')
}
