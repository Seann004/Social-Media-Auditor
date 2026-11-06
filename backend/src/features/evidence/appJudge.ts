/**
 * Judges one checklist item from the recorded steps of its app check: the step lines and the pages
 * seen at each step go to Phase 1's assessment, and one suggestion is stored with its flags and
 * close-ups. Finish observations are never passages and never evidence.
 */
import { randomUUID } from 'node:crypto'
import type { AppSession, AppSessionPool } from './appSession.js'
import type { AppStep, StoppedBy } from './appTypes.js'
import { estimateTokens, type AssessItem } from './assess.js'
import { MAX_INPUT_TOKENS_PER_CALL } from './config.js'
import { computeFlags } from './flags.js'
import { normaliseForMatch } from './quotes.js'
import type { NewSuggestion } from './repository.js'
import { storeRound, storeSuggestion, type BatchContext, type Highlighter, type TokenMeter } from './runnerAssess.js'
import { highlightKey } from './runnerHighlights.js'
import { abortable, logRunProblem, type RunCtx } from './runnerShared.js'
import type { CapturedPage, Passage, Suggestion } from './types.js'

export const APP_NO_STEPS_REASON = 'The check ended before any page of the app could be recorded.'

/** What the judge reads in place of text the AI typed (ruling A20). */
const TYPED_IN_LINE = 'typed text into'
const TYPED_PLACEHOLDER = '[typed text]'
/** Shorter typed texts are left where they stand: they cannot make a quote on their own, and removing them would garble the passage. */
const MIN_SCRUBBED_CHARS = 3
const STEP_LINE_POSITION = 0

export interface JudgeInput {
  item: AssessItem
  platform: string
  steps: AppStep[]
  /** Step positions (from 1) the AI named as its evidence when it finished. */
  evidenceSteps: number[]
  stoppedBy: StoppedBy | null
  meter: TokenMeter
  highlighter: Highlighter | null
}

/**
 * The passages of one judge call. The newest step lines that fit in half the budget, sent in step
 * order (the oldest are dropped first); then round-robin over the pages' passages, in their
 * priority order, within the rest of the budget, skipping any passage already sent as a step line.
 */
export function selectStepPassages(stepLines: Passage[], pagePassages: Passage[][], maxTokens: number = MAX_INPUT_TOKENS_PER_CALL): Passage[] {
  const lineBudget = maxTokens / 2
  const newestFirst: Passage[] = []
  let used = 0
  for (const line of [...stepLines].reverse()) {
    const cost = estimateTokens(line.text)
    if (used + cost > lineBudget) break
    newestFirst.push(line)
    used += cost
  }
  const selected = [...newestFirst].reverse()
  const sent = new Set(selected.map((p) => p.id))
  const rounds = Math.max(0, ...pagePassages.map((list) => list.length))
  for (let round = 0; round < rounds; round++) {
    for (const list of pagePassages) {
      const p = list[round]
      if (!p || sent.has(p.id)) continue
      const cost = estimateTokens(p.text)
      if (used + cost > maxTokens) continue
      sent.add(p.id)
      selected.push(p)
      used += cost
    }
  }
  return selected
}

/** Every text the AI typed in this check, longest first, so that a longer one is replaced before a part of it. */
function typedTexts(steps: AppStep[]): string[] {
  const texts = steps.flatMap((s) => (s.action.type === 'type' ? [s.action.text] : []))
  return [...new Set(texts)].sort((a, b) => b.length - a.length)
}

/**
 * The passage as the judge reads it: text the AI typed itself is not evidence, so it is taken out of
 * the step line (`typed text into ...`) and out of anything else that shows it, such as a text box's
 * value or a posted message (ruling A20). The stored passage keeps it.
 */
function withoutTyped(passage: Passage, typed: string[]): Passage {
  let text = passage.text
  for (const t of typed) text = text.split(`typed "${t}" into`).join(TYPED_IN_LINE)
  for (const t of typed) {
    const wanted = normaliseForMatch(t)
    if (wanted.length < MIN_SCRUBBED_CHARS) continue
    const normalised = normaliseForMatch(text)
    if (normalised.includes(wanted)) text = normalised.split(wanted).join(TYPED_PLACEHOLDER)
  }
  return text === passage.text ? passage : { ...passage, text }
}

/** Page ids: the pages of the evidence steps, in the order named, then the other step pages, newest first. */
function pagePriority(stepPages: AppStep[], evidenceSteps: number[]): string[] {
  const byPosition = new Map(stepPages.map((s) => [s.position, s.pageId as string]))
  const named = evidenceSteps.flatMap((n) => (byPosition.has(n) ? [byPosition.get(n) as string] : []))
  const rest = [...stepPages].reverse().map((s) => s.pageId as string)
  return [...new Set([...named, ...rest])]
}

function groupByPage(passages: Passage[]): Map<string, Passage[]> {
  const byPage = new Map<string, Passage[]>()
  for (const p of passages) byPage.set(p.pageId, [...(byPage.get(p.pageId) ?? []), p])
  return byPage
}

function noStepsSuggestion(ctx: RunCtx, input: JudgeInput): NewSuggestion {
  return {
    runId: ctx.run.id,
    projectId: ctx.run.projectId,
    itemId: input.item.id,
    suggestedResult: null,
    reason: APP_NO_STEPS_REASON,
    confidence: 'medium',
    flags: computeFlags({
      suggestedResult: null,
      evidenceSufficient: false,
      conflicting: false,
      webAssessable: true,
      confidence: 'medium',
      aiReason: APP_NO_STEPS_REASON,
      passagesFound: 0,
      quotes: [],
      failedPages: [],
      source: 'app',
      stoppedBy: input.stoppedBy,
    }),
    passageIdsSent: [],
    source: 'app',
    quotes: [],
  }
}

/**
 * Judges the item from its steps and stores one suggestion with source `app`. Stores a null
 * suggestion without calling the AI when no step recorded a page. Returns null when the AI left the
 * item out (or the item was deleted meanwhile). A failed AI call, a Groq limit among them, is thrown
 * on to the caller.
 */
export async function judgeItem(ctx: RunCtx, input: JudgeInput): Promise<Suggestion | null> {
  const stepPages = [...input.steps].filter((s) => s.pageId !== null).sort((a, b) => a.position - b.position)
  if (stepPages.length === 0) return storeSuggestion(ctx, noStepsSuggestion(ctx, input))

  const typed = typedTexts(input.steps)
  const passages = await ctx.deps.repo.listPassagesOfPages(stepPages.map((s) => s.pageId as string))
  const byPage = groupByPage(passages.map((p) => withoutTyped(p, typed)))
  const stepLines = stepPages.flatMap((s) => (byPage.get(s.pageId as string) ?? []).filter((p) => p.position === STEP_LINE_POSITION))
  const pagePassages = pagePriority(stepPages, input.evidenceSteps).map((id) =>
    (byPage.get(id) ?? []).filter((p) => p.position !== STEP_LINE_POSITION),
  )
  const selected = selectStepPassages(stepLines, pagePassages)

  const { item, platform } = input
  const output = await abortable(
    ctx.deps.assessBatch({ items: [item], passages: selected, platform, apiKey: ctx.deps.apiKey, model: ctx.deps.model, evidenceKind: 'app' }),
    ctx.signal,
  )
  input.meter.add(output.tokensUsed)

  const batch: BatchContext = {
    platform,
    pages: new Map(),
    failedPages: [],
    source: 'app',
    stoppedBy: input.stoppedBy === null ? undefined : new Map([[item.id, input.stoppedBy]]),
  }
  const round = {
    selected,
    found: new Map([[item.id, selected.length]]),
    results: output.results.filter((r) => r.itemId === item.id),
  }
  const [stored] = await storeRound(ctx, round, batch, input.highlighter)
  return stored ?? null
}

/** Whether the session is still on the page: its redacted live address against the page's stored (redacted) address. */
function isStillOn(session: AppSession, pageUrl: string): boolean {
  try {
    return session.currentUrl() === pageUrl
  } catch {
    return false
  }
}

async function photograph(ctx: RunCtx, session: AppSession, quote: string, pageUrl: string): Promise<string | null> {
  let image: Buffer | null
  try {
    image = await session.photographQuote(quote)
  } catch (err) {
    logRunProblem(ctx, `Could not take a close-up on ${pageUrl}`, err)
    return null
  }
  if (image === null) return null
  const path = `${ctx.run.projectId}/${ctx.run.id}/highlight-${randomUUID()}.jpg`
  try {
    await ctx.deps.screenshots.upload(path, image)
    return path
  } catch (err) {
    logRunProblem(ctx, `Could not save a close-up of ${pageUrl}`, err)
    return null
  }
}

/**
 * Close-ups from the live sessions. A quote is photographed only while its step's account session
 * is still on that page's address, so the picture is of the page the quote came from. A quote that
 * cannot be photographed is left out. Never rejects and never opens a browser.
 */
export function liveHighlighter(
  ctx: RunCtx,
  pool: AppSessionPool,
  steps: AppStep[],
  pages: ReadonlyMap<string, CapturedPage>,
): Highlighter {
  const accountOfPage = new Map(steps.flatMap((s) => (s.pageId === null ? [] : [[s.pageId, s.accountId] as const])))
  return async (quotesByPage) => {
    const paths = new Map<string, string>()
    for (const [pageId, quotes] of quotesByPage) {
      const page = pages.get(pageId)
      const accountId = accountOfPage.get(pageId) ?? null
      const session = accountId === null ? null : pool.get(accountId)
      if (!page || session === null) continue
      const pageUrl = page.finalUrl ?? page.url
      for (const quote of quotes) {
        if (ctx.signal.aborted || !isStillOn(session, pageUrl)) break
        const path = await photograph(ctx, session, quote, pageUrl)
        if (path !== null) paths.set(highlightKey(pageId, quote), path)
      }
    }
    return paths
  }
}
