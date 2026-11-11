/**
 * Judges one checklist item from pieces of a code repository. Each piece is stored as a page at its
 * GitHub permalink with one passage (a header line naming the file and lines, then the code), then
 * goes to Phase 1's assessment. When the first answer is null, one small call asks for more search
 * words and the item is judged once more: the new pieces first, then the first round's pieces that
 * still fit. Each call stays within MAX_INPUT_TOKENS_PER_CALL, and a piece that is not sent is not
 * stored. Only the final round is stored as the suggestion.
 */
import { createHash } from 'node:crypto'
import { estimateTokens, type AssessItem } from './assess.js'
import { MAX_INPUT_TOKENS_PER_CALL, MAX_TOKENS_PER_RUN, REPO_MAX_PIECES_PER_ITEM } from './config.js'
import { isQuoteVerified, normaliseForMatch } from './quotes.js'
import { permalinkOf } from './repoAddress.js'
import { cutToFit, withinBudget } from './repoBudget.js'
import type { RepoRepository } from './repoRepository.js'
import { findPieces, isCommentLine, isDocsOrTestPath, pieceKey } from './repoSearch.js'
import { askMoreTerms } from './repoTerms.js'
import type { PieceDraft, RepoFile, RepoPiece, RepoSnapshot, SearchTerms } from './repoTypes.js'
import { storeRound, storeSuggestion, withoutEvidence, type BatchContext, type Round, type TokenMeter } from './runnerAssess.js'
import { abortable, type RunCtx } from './runnerShared.js'
import type { Passage, Suggestion } from './types.js'

export const REPO_NO_CODE_REASON = 'No code in the repository matches this item.'
/** The no-code reason when the archive was larger than the limits and only its first part was read. */
export const REPO_NO_CODE_TRUNCATED_REASON =
  `${REPO_NO_CODE_REASON} Only the first part of the repository was read, because it is larger than the limits.`

const PIECE_PASSAGE_POSITION = 0

export interface StoredPiece {
  piece: RepoPiece
  passage: Passage
}

export interface RepoJudgeInput {
  item: AssessItem
  platform: string
  files: RepoFile[]
  snapshot: RepoSnapshot
  terms: SearchTerms
  repoRepo: RepoRepository
  meter: TokenMeter
}

export interface RepoRejudgeInput {
  item: AssessItem
  platform: string
  pieces: RepoPiece[]
  meter: TokenMeter
}

/** The first line of a piece's passage: SafetyAudit's own words, never the repository's. */
export function headerOf(path: string, startLine: number, endLine: number): string {
  return `File ${path}, lines ${startLine}–${endLine}`
}

function passageText(d: PieceDraft): string {
  return `${headerOf(d.path, d.startLine, d.endLine)}\n${d.code}`
}

/** The drafts, in rank order, whose passages fit one call together; a piece too big alone is cut down first. */
function fitDrafts(drafts: PieceDraft[]): PieceDraft[] {
  const sized = drafts.map((d) => cutToFit(d, passageText, MAX_INPUT_TOKENS_PER_CALL))
  return withinBudget(sized, (d) => estimateTokens(passageText(d)), MAX_INPUT_TOKENS_PER_CALL)
}

const passageCost = (p: Passage): number => estimateTokens(p.text)

/** A stored passage too big for one call alone is sent cut short (never the case with the search's cap). */
function sendable(p: Passage): Passage {
  const maxChars = MAX_INPUT_TOKENS_PER_CALL * 4
  return p.text.length > maxChars ? { ...p, text: p.text.slice(0, maxChars) } : p
}

function splitPassage(text: string): { header: string; code: string } {
  const at = text.indexOf('\n')
  return at === -1 ? { header: text, code: '' } : { header: text.slice(0, at), code: text.slice(at + 1) }
}

/**
 * Stores each draft as a page at its permalink with one passage, then the pieces in one call, in
 * the drafts' order. Live pieces belong to the run's own id.
 */
export async function storePieces(
  ctx: RunCtx,
  repoRepo: RepoRepository,
  snapshot: RepoSnapshot,
  itemId: string,
  drafts: PieceDraft[],
  round: 1 | 2,
): Promise<StoredPiece[]> {
  const passages: Passage[] = []
  for (const d of drafts) {
    const header = headerOf(d.path, d.startLine, d.endLine)
    const text = passageText(d)
    const link = permalinkOf(snapshot.owner, snapshot.name, snapshot.commitSha, d.path, d.startLine, d.endLine)
    const page = await ctx.deps.repo.addPage(ctx.run.id, {
      url: link,
      finalUrl: link,
      httpStatus: null,
      accessStatus: 'ok',
      accessDetail: null,
      title: header,
      text,
      accessibilitySnapshot: null,
      screenshotPath: null,
      contentHash: createHash('sha256').update(text).digest('hex'),
    })
    const [passage] = await ctx.deps.repo.addPassages(page.id, [{ position: PIECE_PASSAGE_POSITION, kind: 'text', text }])
    passages.push(passage)
  }
  const pieces = await repoRepo.addPieces(
    drafts.map((d, i) => ({
      runId: ctx.run.id,
      itemId,
      pageId: passages[i].pageId,
      path: d.path,
      startLine: d.startLine,
      endLine: d.endLine,
      commitSha: snapshot.commitSha,
      round,
    })),
  )
  return pieces.map((piece, i) => ({ piece, passage: passages[i] }))
}

/**
 * A quote is unproven when it is contained in the header line (SafetyAudit's own words), or when
 * it is not in the code below the header at all (so it only matches by running into the header).
 */
function isHeaderQuote(quote: string, passage: Passage): boolean {
  const { header, code } = splitPassage(passage.text)
  return normaliseForMatch(header).includes(normaliseForMatch(quote)) || !isQuoteVerified(quote, code)
}

/**
 * The code lines that hold part of any occurrence of the quote, matched as the quote check does
 * (after normaliseForMatch). Null when the quote is not found line by line.
 */
function linesOfQuote(code: string, quote: string): string[] | null {
  const spans: { start: number; end: number; line: string }[] = []
  let joined = ''
  for (const line of code.split('\n')) {
    const normal = normaliseForMatch(line)
    if (normal === '') continue
    if (joined !== '') joined += ' '
    spans.push({ start: joined.length, end: joined.length + normal.length, line })
    joined += normal
  }
  const wanted = normaliseForMatch(quote)
  if (wanted === '') return null
  const touched = new Set<string>()
  let found = false
  for (let at = joined.indexOf(wanted); at !== -1; at = joined.indexOf(wanted, at + 1)) {
    found = true
    for (const s of spans) if (s.start < at + wanted.length && s.end > at) touched.add(s.line)
  }
  return found ? [...touched] : null
}

/**
 * `comments_only`: at least one verified quote, and each comes from a docs or test file, or only
 * from comment lines. A quote that cannot be placed line by line counts as a comment, so the
 * warning errs on the side of showing.
 */
function commentsOnlyRule(pathOfPage: ReadonlyMap<string, string>): Round['commentsOnly'] {
  return (verified) =>
    verified.length > 0 &&
    verified.every(({ text, passage }) => {
      const path = pathOfPage.get(passage.pageId)
      if (path !== undefined && isDocsOrTestPath(path)) return true
      const lines = linesOfQuote(splitPassage(passage.text).code, text)
      return lines === null || lines.every(isCommentLine)
    })
}

function repoBatch(platform: string): BatchContext {
  return { platform, pages: new Map(), failedPages: [], source: 'repo' }
}

async function assessPieces(ctx: RunCtx, item: AssessItem, platform: string, passages: Passage[], meter: TokenMeter) {
  const output = await abortable(
    ctx.deps.assessBatch({ items: [item], passages, platform, apiKey: ctx.deps.apiKey, model: ctx.deps.model, evidenceKind: 'repo' }),
    ctx.signal,
  )
  meter.add(output.tokensUsed)
  return output.results.filter((r) => r.itemId === item.id)
}

/** Stores the final round: quotes of the header are unproven, there are no close-ups, and no browser opens. */
async function storeFinal(
  ctx: RunCtx,
  item: AssessItem,
  batch: BatchContext,
  selected: Passage[],
  results: Round['results'],
  pathOfPage: ReadonlyMap<string, string>,
): Promise<Suggestion | null> {
  const round: Round = {
    selected,
    found: new Map([[item.id, selected.length]]),
    results,
    isUnproven: isHeaderQuote,
    commentsOnly: commentsOnlyRule(pathOfPage),
    takesCloseUp: () => false,
  }
  const [stored] = await storeRound(ctx, round, batch, null)
  return stored ?? null
}

/**
 * Round 2: more terms from the AI, a search for new pieces, and the storing of those that fit one
 * call. Empty when nothing new is found.
 */
async function secondRound(ctx: RunCtx, input: RepoJudgeInput, first: StoredPiece[]): Promise<StoredPiece[]> {
  const { item, platform, files, meter } = input
  const more = await abortable(
    askMoreTerms({
      item,
      platform,
      seenPaths: first.map((s) => s.piece.path),
      paths: files.map((f) => f.path),
      avoidPaths: input.terms.avoidPaths,
      apiKey: ctx.deps.apiKey,
      model: ctx.deps.model,
      signal: ctx.signal,
    }),
    ctx.signal,
  )
  meter.add(more.tokensUsed)
  const exclude = new Set(first.map((s) => pieceKey(s.piece)))
  // Round 1's avoid words carry on when the AI names none in round 2.
  const terms = { ...more.terms, avoidPaths: more.terms.avoidPaths ?? input.terms.avoidPaths }
  const drafts = fitDrafts(findPieces(files, terms, { exclude, max: REPO_MAX_PIECES_PER_ITEM }))
  if (drafts.length === 0) return []
  return storePieces(ctx, input.repoRepo, input.snapshot, item.id, drafts, 2)
}

/**
 * Judges the item from the code and stores one suggestion with source `repo`. Stores the no-code
 * suggestion without calling the AI when the search finds nothing. Returns null when the AI left
 * the item out (or the item was deleted meanwhile). A failed AI call, a Groq limit among them, is
 * thrown on to the caller.
 */
export async function judgeRepoItem(ctx: RunCtx, input: RepoJudgeInput): Promise<Suggestion | null> {
  const { item, platform, meter } = input
  const batch = repoBatch(platform)
  const drafts = fitDrafts(findPieces(input.files, input.terms, { max: REPO_MAX_PIECES_PER_ITEM }))
  if (drafts.length === 0) {
    const reason = input.snapshot.truncated ? REPO_NO_CODE_TRUNCATED_REASON : REPO_NO_CODE_REASON
    return storeSuggestion(ctx, withoutEvidence(ctx, item, batch, reason))
  }

  const first = await storePieces(ctx, input.repoRepo, input.snapshot, item.id, drafts, 1)
  let stored = first
  let results = await assessPieces(ctx, item, platform, first.map((s) => s.passage), meter)
  // An answer that the item can't be judged from the code is final: more code would not change it.
  const wantsMore = results[0]?.suggestedResult === null && results[0].webAssessable !== false
  if (wantsMore && meter.used() < MAX_TOKENS_PER_RUN) {
    const second = await secondRound(ctx, input, first)
    if (second.length > 0) {
      // The new pieces answer what the AI asked for, so they go first; then round 1 while it fits.
      const used = second.reduce((n, s) => n + passageCost(s.passage), 0)
      stored = [...second, ...withinBudget(first, (s) => passageCost(s.passage), MAX_INPUT_TOKENS_PER_CALL, used)]
      results = await assessPieces(ctx, item, platform, stored.map((s) => s.passage), meter)
    }
  }
  const pathOfPage = new Map(stored.map((s) => [s.piece.pageId, s.piece.path]))
  return storeFinal(ctx, item, batch, stored.map((s) => s.passage), results, pathOfPage)
}

/**
 * Re-assess: one call over the stored passages of the item's pieces, with the same rules and the
 * same budget: round 2 first, then round 1, each in stored order. Never searches. With no pieces,
 * stores the no-code suggestion.
 */
export async function rejudgeRepoItem(ctx: RunCtx, input: RepoRejudgeInput): Promise<Suggestion | null> {
  const { item, platform, pieces, meter } = input
  const batch = repoBatch(platform)
  if (pieces.length === 0) return storeSuggestion(ctx, withoutEvidence(ctx, item, batch, REPO_NO_CODE_REASON))
  const ordered = [...pieces.filter((p) => p.round === 2), ...pieces.filter((p) => p.round === 1)]
  const stored = await ctx.deps.repo.listPassagesOfPages(ordered.map((p) => p.pageId))
  const passages = withinBudget(stored.map(sendable), passageCost, MAX_INPUT_TOKENS_PER_CALL)
  const results = await assessPieces(ctx, item, platform, passages, meter)
  const pathOfPage = new Map(pieces.map((p) => [p.pageId, p.path]))
  return storeFinal(ctx, item, batch, passages, results, pathOfPage)
}
