/**
 * Counts the tokens each AI feature uses, so the real cost of a test round can be worked out instead of guessed.
 * Totals are kept in memory (they reset when the server restarts) and every call also writes one log line.
 */

export type AiFeature = 'evidence' | 'matching' | 'extraction'

export interface TokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface AiUsageTotal {
  feature: AiFeature
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
}

let totals: ReadonlyMap<string, AiUsageTotal> = new Map()

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/** Adds one call. A reply with no usage still counts as a call, with zero tokens. */
export function recordAiUsage(feature: AiFeature, model: string, usage?: TokenUsage | null): void {
  const input = whole(usage?.prompt_tokens)
  const output = whole(usage?.completion_tokens)
  const key = `${feature}|${model}`
  const before = totals.get(key)
  const next: AiUsageTotal = {
    feature,
    model,
    calls: (before?.calls ?? 0) + 1,
    inputTokens: (before?.inputTokens ?? 0) + input,
    outputTokens: (before?.outputTokens ?? 0) + output,
  }
  totals = new Map(totals).set(key, next)
  console.log(`[ai-usage] ${JSON.stringify({ feature, model, inputTokens: input, outputTokens: output })}`)
}

/** The totals since the server started, one row per feature and model. */
export function getAiUsage(): AiUsageTotal[] {
  return Array.from(totals.values(), (row) => ({ ...row })).sort((a, b) => a.feature.localeCompare(b.feature) || a.model.localeCompare(b.model))
}

export function resetAiUsage(): void {
  totals = new Map()
}
