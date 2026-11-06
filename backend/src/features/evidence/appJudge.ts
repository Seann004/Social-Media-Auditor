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
import { normaliseForMatch } from './quotes.js'
import { storeRound, storeSuggestion, withoutEvidence, type BatchContext, type Highlighter, type Round, type TokenMeter } from './runnerAssess.js'
import { highlightKey } from './runnerHighlights.js'
import { abortable, logRunProblem, type RunCtx } from './runnerShared.js'
import type { CapturedPage, Passage, Suggestion } from './types.js'

export const APP_NO_STEPS_REASON = 'The check ended before any page of the app could be recorded.'

/** What the judge's copy of a step line says in place of the text the AI typed (ruling A20). */
const TYPED_IN_LINE = 'typed text into'
const STEP_LINE_POSITION = 0
const EDGE_PUNCTUATION = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu
const WORD = /[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu
/** A quote sharing this many consecutive words with a typed text is the AI's own (ruling A20c). */
const SHARED_RUN_WORDS = 4
/** A typed text of at least this many words, found whole inside a quote, makes the quote the AI's own (ruling A20c). */
const WHOLE_TYPED_MIN_WORDS = 2

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

/** Every text the AI typed in this check, whatever the outcome. */
function typedTexts(steps: AppStep[]): string[] {
  return steps.flatMap((s) => (s.action.type === 'type' ? [s.action.text] : []))
}

/** The options the AI named in selects that were refused or failed. A done select's option was offered by the app. */
function namedOptions(steps: AppStep[]): string[] {
  return steps.flatMap((s) => (s.action.type === 'select' && (s.outcome === 'refused' || s.outcome === 'failed') ? [s.action.option] : []))
}

/** The whole words of a text: NFKC, lower case, whitespace collapsed. */
function wordsOf(text: string): string[] {
  return normaliseForMatch(text).toLowerCase().match(WORD) ?? []
}

/** Every run of `size` consecutive words, joined by single spaces. */
function runsOf(words: string[], size: number): string[] {
  return words.length < size ? [] : words.slice(0, words.length - size + 1).map((_, i) => words.slice(i, i + size).join(' '))
}

/** How A20b compares a quote with what the AI wrote: NFKC, whitespace collapsed, lower case, no punctuation at either end. */
function comparable(text: string): string {
  return normaliseForMatch(text).toLowerCase().replace(EDGE_PUNCTUATION, '')
}

/** The judge's copy of a step line says `typed text into ...`: what the AI typed is not the app's. The stored line keeps it. */
function withoutTypedText(passage: Passage, steps: AppStep[]): Passage {
  if (passage.position !== STEP_LINE_POSITION) return passage
  const step = steps.find((s) => s.pageId === passage.pageId)
  if (step?.action.type !== 'type') return passage
  const text = passage.text.split(`typed "${step.action.text}" into`).join(TYPED_IN_LINE)
  return text === passage.text ? passage : { ...passage, text }
}

/**
 * Rulings A20b and A20c. A quote is unproven when:
 * - it is contained in anything the AI wrote (a typed text, or the option of a refused or failed
 *   select), however the app showed it: cut short, in capitals;
 * - it shares 4 or more consecutive whole words with a typed text, as when the app wraps the text
 *   (`[value: …]`, "Your post: …");
 * - it contains, as whole words, a whole typed text of 2 or more words;
 * - or it names the line of a refused, failed or stopped step: that line is SafetyAudit's own rule
 *   or error, not the app's doing.
 * A one-word typed text (a search for "private") is covered by containment only.
 */
function unprovenRule(steps: AppStep[]): (quote: string, passage: Passage) => boolean {
  const typed = typedTexts(steps)
  const written = [...typed, ...namedOptions(steps)].map(comparable)
  const typedWords = typed.map(wordsOf)
  const sharedRuns = new Set(typedWords.flatMap((words) => runsOf(words, SHARED_RUN_WORDS)))
  const wholeTyped = typedWords.filter((words) => words.length >= WHOLE_TYPED_MIN_WORDS).map((words) => words.join(' '))
  const notDoneLines = new Set(steps.flatMap((s) => (s.pageId !== null && s.outcome !== 'done' ? [s.pageId] : [])))
  return (quote, passage) => {
    if (passage.position === STEP_LINE_POSITION && notDoneLines.has(passage.pageId)) return true
    const wanted = comparable(quote)
    if (written.some((text) => text.includes(wanted))) return true
    const words = wordsOf(quote)
    if (runsOf(words, SHARED_RUN_WORDS).some((run) => sharedRuns.has(run))) return true
    const padded = ` ${words.join(' ')} `
    return wholeTyped.some((text) => padded.includes(` ${text} `))
  }
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

/**
 * Judges the item from its steps and stores one suggestion with source `app`. Stores a null
 * suggestion without calling the AI when no step recorded a page. Returns null when the AI left the
 * item out (or the item was deleted meanwhile). A failed AI call, a Groq limit among them, is thrown
 * on to the caller.
 */
export async function judgeItem(ctx: RunCtx, input: JudgeInput): Promise<Suggestion | null> {
  const { item, platform } = input
  const batch: BatchContext = {
    platform,
    pages: new Map(),
    failedPages: [],
    source: 'app',
    stoppedBy: input.stoppedBy === null ? undefined : new Map([[item.id, input.stoppedBy]]),
  }
  const stepPages = [...input.steps].filter((s) => s.pageId !== null).sort((a, b) => a.position - b.position)
  if (stepPages.length === 0) return storeSuggestion(ctx, withoutEvidence(ctx, item, batch, APP_NO_STEPS_REASON))

  const passages = await ctx.deps.repo.listPassagesOfPages(stepPages.map((s) => s.pageId as string))
  const byPage = groupByPage(passages.map((p) => withoutTypedText(p, input.steps)))
  const stepLines = stepPages.flatMap((s) => (byPage.get(s.pageId as string) ?? []).filter((p) => p.position === STEP_LINE_POSITION))
  const pagePassages = pagePriority(stepPages, input.evidenceSteps).map((id) =>
    (byPage.get(id) ?? []).filter((p) => p.position !== STEP_LINE_POSITION),
  )
  const selected = selectStepPassages(stepLines, pagePassages)

  const output = await abortable(
    ctx.deps.assessBatch({ items: [item], passages: selected, platform, apiKey: ctx.deps.apiKey, model: ctx.deps.model, evidenceKind: 'app' }),
    ctx.signal,
  )
  input.meter.add(output.tokensUsed)

  const round: Round = {
    selected,
    found: new Map([[item.id, selected.length]]),
    results: output.results.filter((r) => r.itemId === item.id),
    isUnproven: unprovenRule(input.steps),
    // A step line is SafetyAudit's own words, never on the page: close-ups are for page text.
    takesCloseUp: (p) => p.position !== STEP_LINE_POSITION,
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

/** Each account's newest recorded step page: the only page of that account the live session can still show. */
function newestPageOfEach(steps: AppStep[]): Map<string, string> {
  const newest = new Map<string, AppStep>()
  for (const step of steps) {
    if (step.pageId === null || step.accountId === null) continue
    const known = newest.get(step.accountId)
    if (known === undefined || step.position > known.position) newest.set(step.accountId, step)
  }
  return new Map([...newest.values()].map((s) => [s.pageId as string, s.accountId as string]))
}

/**
 * Close-ups from the live sessions. A quote is photographed only on its account's newest step page,
 * and only while that session is still on the page's address, so the picture is of the page the
 * quote came from (an older step on the same address may no longer look the same). A quote that
 * cannot be photographed is left out. Never rejects and never opens a browser.
 */
export function liveHighlighter(
  ctx: RunCtx,
  pool: AppSessionPool,
  steps: AppStep[],
  pages: ReadonlyMap<string, CapturedPage>,
): Highlighter {
  const accountOfPage = newestPageOfEach(steps)
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
