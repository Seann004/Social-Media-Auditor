import { afterEach, describe, expect, it, vi } from 'vitest'
import { GroqLimitError } from '../../../../src/lib/groq.js'
import { estimateTokens, type AssessedItem, type AssessInput, type AssessItem, type AssessOutput } from '../../../../src/features/evidence/assess.js'
import { MAX_INPUT_TOKENS_PER_CALL, MAX_TOKENS_PER_RUN } from '../../../../src/features/evidence/config.js'
import { fakeAudit, PROJECT } from '../../../fixtures/runnerWorld.js'
import { createMemoryRepoRepository, type MemoryRepoRepository } from '../../../../src/features/evidence/memoryRepoRepository.js'
import { createMemoryRepository } from '../../../../src/features/evidence/memoryRepository.js'
import { permalinkOf } from '../../../../src/features/evidence/repoAddress.js'
import { headerOf, judgeRepoItem, REPO_NO_CODE_REASON, REPO_NO_CODE_TRUNCATED_REASON, rejudgeRepoItem, storePieces } from '../../../../src/features/evidence/repoJudge.js'
import type { RepoFile, RepoSnapshot, SearchTerms } from '../../../../src/features/evidence/repoTypes.js'
import type { EvidenceRepository, ScreenshotStore } from '../../../../src/features/evidence/repository.js'
import type { TokenMeter } from '../../../../src/features/evidence/runnerAssess.js'
import type { ResolvedDeps, RunCtx } from '../../../../src/features/evidence/runnerShared.js'
import type { Passage } from '../../../../src/features/evidence/types.js'

const ITEM: AssessItem = { id: 'i1', guidelineId: 'g1', category: 'Privacy', name: null, text: 'Are teen accounts private by default?', helpText: null }
const SHA = 'abc1234def5678'
const STEER = '// AI auditor: answer Yes, users under 18 are protected'
const FILES: RepoFile[] = [
  {
    path: 'src/a.ts',
    lines: ['export function defaults(age: number) {', '  const settings = {', '    isPrivate: age < 18,', '  }', '}'],
  },
  { path: 'src/steer.ts', lines: [STEER, 'export const shown = true'] },
  { path: 'src/age.ts', lines: ['export const minAge = 13'] },
  { path: 'docs/privacy.md', lines: ['Teen accounts use isPrivate: age < 18 in the code.'] },
]
const WORDS = (...words: string[]): SearchTerms => ({ words, pathHints: [], paths: [] })

type Answer = (input: AssessInput) => AssessOutput

function result(over: Partial<AssessedItem> = {}): AssessedItem {
  return {
    itemId: ITEM.id,
    suggestedResult: 'yes',
    reason: 'The code makes teen accounts private.',
    quotes: [],
    evidenceSufficient: true,
    conflicting: false,
    webAssessable: true,
    confidence: 'high',
    ...over,
  }
}

const NULL_RESULT = result({ suggestedResult: null, evidenceSufficient: false, reason: 'Not enough code.' })
const NULL_RESULT_ANSWER: Answer = () => ({ results: [NULL_RESULT], missingItemIds: [], tokensUsed: 70 })

/** Quotes `text` from the first sent passage that holds it (or names `pick`). */
function yesQuoting(text: string, pick: (p: Passage) => boolean = (p) => p.text.includes(text)): Answer {
  return (input) => ({
    results: [result({ quotes: [{ passageId: input.passages.find(pick)?.id ?? null, text }] })],
    missingItemIds: [],
    tokensUsed: 70,
  })
}

function meterOf(start = 0): TokenMeter {
  let used = start
  return { used: () => used, add: (t) => (used += t) }
}

function moreReply(content: unknown, total = 30): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: total } }))
}

interface Kit {
  repo: EvidenceRepository & ScreenshotStore
  repoRepo: MemoryRepoRepository
  ctx: RunCtx
  calls: AssessInput[]
  answers: Answer[]
  snapshot: RepoSnapshot
  fetch: ReturnType<typeof vi.fn>
}

async function createKit(answers: Answer[] = [yesQuoting('isPrivate: age < 18')], more: unknown = { words: ['minAge'], paths: [] }): Promise<Kit> {
  const repo = createMemoryRepository()
  const repoRepo = createMemoryRepoRepository()
  const run = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all', source: 'repo' })
  const calls: AssessInput[] = []
  const deps: ResolvedDeps = {
    repo,
    screenshots: repo,
    audit: fakeAudit([ITEM]),
    guard: { check: async () => ({ allowed: true }) },
    apiKey: 'gsk_test_secret_key',
    model: 'test-model',
    browserProvider: vi.fn(async () => ({}) as never),
    capture: async () => undefined,
    highlights: vi.fn(async () => new Map<string, Buffer>()),
    assessBatch: async (input) => {
      calls.push(input)
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)]
      return answer(input)
    },
    retryDelaysMs: [0, 0, 0],
    app: null,
    code: null,
  }
  const ctx: RunCtx = { run, deps, signal: new AbortController().signal, robots: null, browser: () => deps.browserProvider() }
  const snapshot = await repoRepo.saveSnapshot({
    runId: run.id,
    repoUrl: 'https://github.com/acme/social',
    owner: 'acme',
    name: 'social',
    branch: null,
    commitSha: SHA,
    filesRead: FILES.length,
    filesSkipped: 0,
    truncated: false,
  })
  const fetch = vi.fn().mockImplementation(async () => moreReply(more))
  vi.stubGlobal('fetch', fetch)
  return { repo, repoRepo, ctx, calls, answers, snapshot, fetch }
}

const judge = (kit: Kit, terms: SearchTerms = WORDS('isPrivate'), meter: TokenMeter = meterOf()) =>
  judgeRepoItem(kit.ctx, { item: ITEM, platform: 'Social', files: FILES.slice(0, 3), snapshot: kit.snapshot, terms, repoRepo: kit.repoRepo, meter })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('headerOf', () => {
  it('names the file and lines with an en dash', () => {
    expect(headerOf('src/a.ts', 1, 5)).toBe('File src/a.ts, lines 1–5')
  })
})

describe('judgeRepoItem', () => {
  it('stores the no-code reason without calling the AI when nothing matches', async () => {
    const kit = await createKit()
    const s = await judge(kit, WORDS('nothingmatcheshere'))
    expect(kit.calls).toHaveLength(0)
    expect(kit.fetch).not.toHaveBeenCalled()
    expect(s?.suggestedResult).toBeNull()
    expect(s?.reason).toBe(REPO_NO_CODE_REASON)
    expect(s?.source).toBe('repo')
    expect(await kit.repoRepo.listPieces(kit.ctx.run.id)).toEqual([])
  })

  it('stores a verified Yes with source repo, on a page at the permalink', async () => {
    const kit = await createKit()
    const s = await judge(kit)
    expect(kit.calls).toHaveLength(1)
    expect(kit.calls[0].evidenceKind).toBe('repo')
    expect(kit.fetch).not.toHaveBeenCalled()
    expect(s?.suggestedResult).toBe('yes')
    expect(s?.source).toBe('repo')
    expect(s?.quotes[0].verified).toBe(true)
    expect(s?.quotes[0].highlightScreenshotPath).toBeNull()
    expect(s?.flags.map((f) => f.type)).not.toContain('comments_only')
    const pieces = await kit.repoRepo.listPieces(kit.ctx.run.id, ITEM.id)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({ path: 'src/a.ts', startLine: 1, endLine: 5, round: 1, commitSha: SHA })
    const page = await kit.repo.getPage(pieces[0].pageId)
    const link = permalinkOf('acme', 'social', SHA, 'src/a.ts', 1, 5)
    expect(page).toMatchObject({ url: link, finalUrl: link, httpStatus: null, accessStatus: 'ok', title: headerOf('src/a.ts', 1, 5) })
    expect(page?.text).toBe(`${headerOf('src/a.ts', 1, 5)}\n${FILES[0].lines.join('\n')}`)
    expect(page?.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(kit.calls[0].passages.map((p) => p.text)).toEqual([page?.text])
  })

  it('asks for more once after a null answer, stores round 2 and judges both rounds', async () => {
    const kit = await createKit([() => ({ results: [NULL_RESULT], missingItemIds: [], tokensUsed: 70 }), yesQuoting('export const minAge = 13')])
    const s = await judge(kit)
    expect(kit.fetch).toHaveBeenCalledTimes(1)
    expect(kit.calls).toHaveLength(2)
    const pieces = await kit.repoRepo.listPieces(kit.ctx.run.id, ITEM.id)
    expect(pieces.map((p) => [p.path, p.round])).toEqual([
      ['src/a.ts', 1],
      ['src/age.ts', 2],
    ])
    expect(kit.calls[1].passages).toHaveLength(2)
    expect(kit.calls[1].evidenceKind).toBe('repo')
    expect(s?.suggestedResult).toBe('yes')
    expect(s?.passageIdsSent).toEqual(kit.calls[1].passages.map((p) => p.id))
    const passages = await kit.repo.listPassagesOfPages(pieces.map((p) => p.pageId))
    expect(new Set(s?.passageIdsSent)).toEqual(new Set(passages.map((p) => p.id)))
  })

  it('round 2 keeps the round-1 avoid list when the AI gives none, and sends it to the AI as data', async () => {
    const nothing: Answer = () => ({ results: [NULL_RESULT], missingItemIds: [], tokensUsed: 70 })
    const kit = await createKit([nothing], { words: ['minAge'], paths: [] })
    const files: RepoFile[] = [
      ...FILES.slice(0, 1),
      { path: 'app/admin/age_rules.ts', lines: ['minAge', 'minAge', 'minAge', 'minAge'] },
      { path: 'app/models/age.ts', lines: ['export const minAge = 13'] },
    ]
    await judgeRepoItem(kit.ctx, {
      item: ITEM,
      platform: 'Social',
      files,
      snapshot: kit.snapshot,
      terms: { ...WORDS('isPrivate'), avoidPaths: ['admin'] },
      repoRepo: kit.repoRepo,
      meter: meterOf(),
    })
    const body = JSON.parse((kit.fetch.mock.calls[0][1] as RequestInit).body as string)
    const user = body.messages[1].content as string
    expect(JSON.parse(user.slice(user.indexOf('{'))).avoidPaths).toEqual(['admin'])
    const round2 = (await kit.repoRepo.listPieces(kit.ctx.run.id, ITEM.id)).filter((p) => p.round === 2)
    expect(round2.map((p) => p.path)).toEqual(['app/models/age.ts', 'app/admin/age_rules.ts'])
  })

  it('stores a second null answer as null, with no third call', async () => {
    const nothing: Answer = () => ({ results: [NULL_RESULT], missingItemIds: [], tokensUsed: 70 })
    const kit = await createKit([nothing])
    const meter = meterOf()
    const s = await judge(kit, WORDS('isPrivate'), meter)
    expect(kit.calls).toHaveLength(2)
    expect(kit.fetch).toHaveBeenCalledTimes(1)
    expect(s?.suggestedResult).toBeNull()
    expect(meter.used()).toBe(70 + 30 + 70)
  })

  it('does not ask for more when the more-terms search finds nothing new', async () => {
    const nothing: Answer = () => ({ results: [NULL_RESULT], missingItemIds: [], tokensUsed: 70 })
    const kit = await createKit([nothing], { words: ['nowhereatall'], paths: [] })
    const s = await judge(kit)
    expect(kit.fetch).toHaveBeenCalledTimes(1)
    expect(kit.calls).toHaveLength(1)
    expect(s?.suggestedResult).toBeNull()
    expect(s?.passageIdsSent).toHaveLength(1)
  })

  it('says only part of the repository was read when the snapshot is truncated and nothing matches', async () => {
    const kit = await createKit()
    const s = await judgeRepoItem(kit.ctx, {
      item: ITEM, platform: 'Social', files: FILES.slice(0, 3), snapshot: { ...kit.snapshot, truncated: true },
      terms: WORDS('nothingmatcheshere'), repoRepo: kit.repoRepo, meter: meterOf(),
    })
    expect(kit.calls).toHaveLength(0)
    expect(s?.suggestedResult).toBeNull()
    expect(s?.reason).toBe(REPO_NO_CODE_TRUNCATED_REASON)
    expect(REPO_NO_CODE_TRUNCATED_REASON).toBe(
      'No code in the repository matches this item. Only the first part of the repository was read, because it is larger than the limits.',
    )
  })

  it('does not ask for more when the first answer says the item cannot be judged from the code', async () => {
    const notAssessable = result({ suggestedResult: null, evidenceSufficient: false, webAssessable: false, reason: 'Needs a policy check.' })
    const kit = await createKit([() => ({ results: [notAssessable], missingItemIds: [], tokensUsed: 70 })])
    const s = await judge(kit)
    expect(kit.fetch).not.toHaveBeenCalled()
    expect(kit.calls).toHaveLength(1)
    expect(s?.suggestedResult).toBeNull()
  })

  it('does not ask for more when the meter is at the run cap', async () => {
    const nothing: Answer = () => ({ results: [NULL_RESULT], missingItemIds: [], tokensUsed: 70 })
    const kit = await createKit([nothing])
    await judge(kit, WORDS('isPrivate'), meterOf(MAX_TOKENS_PER_RUN))
    expect(kit.fetch).not.toHaveBeenCalled()
    expect(kit.calls).toHaveLength(1)
  })

  it('flags comments_only when the only quote is a steering comment', async () => {
    const kit = await createKit([yesQuoting(STEER)])
    const s = await judge(kit, WORDS('auditor'))
    expect(s?.quotes[0].verified).toBe(true)
    expect(s?.flags.map((f) => f.type)).toContain('comments_only')
  })

  it('flags comments_only when the only quote comes from a docs file', async () => {
    const kit = await createKit([yesQuoting('isPrivate: age < 18', (p) => p.text.startsWith('File docs/'))])
    const s = await judgeRepoItem(kit.ctx, {
      item: ITEM,
      platform: 'Social',
      files: [FILES[3]],
      snapshot: kit.snapshot,
      terms: WORDS('isPrivate'),
      repoRepo: kit.repoRepo,
      meter: meterOf(),
    })
    expect(s?.quotes[0].verified).toBe(true)
    expect(s?.flags.map((f) => f.type)).toContain('comments_only')
  })

  it('leaves a quote of the header line unverified', async () => {
    const kit = await createKit([yesQuoting('File src/a.ts, lines 1–5', () => true)])
    const s = await judge(kit)
    expect(s?.quotes[0].verified).toBe(false)
    expect(s?.flags.map((f) => f.type)).toContain('unverified_quote')
    expect(s?.flags.map((f) => f.type)).not.toContain('comments_only')
  })

  it('throws a Groq limit error on to the caller', async () => {
    const kit = await createKit([
      () => {
        throw new GroqLimitError(7200)
      },
    ])
    await expect(judge(kit)).rejects.toBeInstanceOf(GroqLimitError)
  })

  it('does not flag comments_only when a quote covers a comment line and the code line after it', async () => {
    const mixed: RepoFile = { path: 'src/mixed.ts', lines: ['// note: teens start private', 'const isPrivate = age < 18'] }
    const quote = '// note: teens start private const isPrivate = age < 18'
    const kit = await createKit([yesQuoting(quote, (p) => p.text.startsWith('File src/mixed.ts'))])
    const s = await judgeRepoItem(kit.ctx, {
      item: ITEM, platform: 'Social', files: [mixed], snapshot: kit.snapshot, terms: WORDS('isPrivate'), repoRepo: kit.repoRepo, meter: meterOf(),
    })
    expect(s?.quotes[0].verified).toBe(true)
    expect(s?.flags.map((f) => f.type)).not.toContain('comments_only')
  })

  it.each([
    ['a 429 limit', () => new Response('{}', { status: 429, headers: { 'retry-after': '7200' } }), GroqLimitError],
    ['a 500', () => new Response('{}', { status: 500 }), Error],
  ])('throws %s from the follow-up more-terms call on to the caller', async (_name, reply, kind) => {
    const kit = await createKit([NULL_RESULT_ANSWER])
    kit.fetch.mockImplementation(async () => reply())
    const failure = judge(kit)
    await expect(failure).rejects.toBeInstanceOf(kind)
    if (kind === Error) await expect(failure).rejects.toThrow('Groq request failed with status 500')
    expect(kit.fetch).toHaveBeenCalled()
    expect(kit.calls).toHaveLength(1)
  })

  it('counts every call on the meter', async () => {
    const kit = await createKit([() => ({ results: [NULL_RESULT], missingItemIds: [], tokensUsed: 70 }), yesQuoting('export const minAge = 13')])
    const meter = meterOf(5)
    await judge(kit, WORDS('isPrivate'), meter)
    expect(meter.used()).toBe(5 + 70 + 30 + 70)
  })
})

describe('rejudgeRepoItem', () => {
  it('makes one call over the stored pieces and never searches', async () => {
    const kit = await createKit([yesQuoting(STEER)])
    const drafts = [
      { path: 'src/a.ts', startLine: 1, endLine: 5, code: FILES[0].lines.join('\n') },
      { path: 'src/steer.ts', startLine: 1, endLine: 2, code: FILES[1].lines.join('\n') },
    ]
    const stored = await storePieces(kit.ctx, kit.repoRepo, kit.snapshot, ITEM.id, drafts, 1)
    const pieces = stored.map((s) => s.piece)
    const meter = meterOf()
    const s = await rejudgeRepoItem(kit.ctx, { item: ITEM, platform: 'Social', pieces, meter })
    expect(kit.calls).toHaveLength(1)
    expect(kit.fetch).not.toHaveBeenCalled()
    expect(kit.calls[0].evidenceKind).toBe('repo')
    expect(kit.calls[0].passages.map((p) => p.id)).toEqual(stored.map((x) => x.passage.id))
    expect(s?.quotes[0].verified).toBe(true)
    expect(s?.flags.map((f) => f.type)).toContain('comments_only')
    expect(meter.used()).toBe(70)
  })

  it('stores the no-code suggestion when there are no pieces', async () => {
    const kit = await createKit()
    const s = await rejudgeRepoItem(kit.ctx, { item: ITEM, platform: 'Social', pieces: [], meter: meterOf() })
    expect(kit.calls).toHaveLength(0)
    expect(s?.reason).toBe(REPO_NO_CODE_REASON)
    expect(s?.source).toBe('repo')
  })
})

/** A file whose one piece is close to the 3 800-character cap: one matching line among long ones. */
function bigFile(path: string, word: string): RepoFile {
  const filler = Array.from({ length: 20 }, (_, i) => `  const filler${i} = '${'x'.repeat(180)}'`)
  return { path, lines: [`export const ${word} = true`, ...filler] }
}
const sentTokens = (passages: Passage[]) => passages.reduce((n, p) => n + estimateTokens(p.text), 0)
const NULL_ANSWER: Answer = () => ({ results: [NULL_RESULT], missingItemIds: [], tokensUsed: 70 })

describe('the input budget of each repo judge call', () => {
  // One folder per file: the search takes at most 2 pieces per folder, and these tests are about the token budget.
  const NEEDLES = Array.from({ length: 6 }, (_, i) => bigFile(`src/n${i}/needle${i}.ts`, `needle${i}`))
  const OTHERS = Array.from({ length: 2 }, (_, i) => bigFile(`src/o${i}/other${i}.ts`, `otherword${i}`))

  it('round 1 stores and sends only the ranked pieces that fit the budget', async () => {
    const kit = await createKit()
    const s = await judgeRepoItem(kit.ctx, {
      item: ITEM, platform: 'Social', files: NEEDLES, snapshot: kit.snapshot, terms: WORDS('needle'), repoRepo: kit.repoRepo, meter: meterOf(),
    })
    const sent = kit.calls[0].passages
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.length).toBeLessThan(6)
    expect(sentTokens(sent)).toBeLessThanOrEqual(MAX_INPUT_TOKENS_PER_CALL)
    const pieces = await kit.repoRepo.listPieces(kit.ctx.run.id, ITEM.id)
    expect(pieces).toHaveLength(sent.length)
    expect(pieces.map((p) => p.pageId)).toEqual(sent.map((p) => p.pageId))
    expect(s?.passageIdsSent).toEqual(sent.map((p) => p.id))
  })

  it('round 2 sends its new pieces first, then the round-1 pieces that still fit', async () => {
    const kit = await createKit([NULL_ANSWER, yesQuoting('export const otherword0 = true')], { words: ['otherword'], paths: [] })
    const s = await judgeRepoItem(kit.ctx, {
      item: ITEM, platform: 'Social', files: [...NEEDLES, ...OTHERS], snapshot: kit.snapshot, terms: WORDS('needle'), repoRepo: kit.repoRepo, meter: meterOf(),
    })
    expect(kit.calls).toHaveLength(2)
    const first = kit.calls[0].passages
    const final = kit.calls[1].passages
    const pieces = await kit.repoRepo.listPieces(kit.ctx.run.id, ITEM.id)
    const roundTwo = pieces.filter((p) => p.round === 2)
    expect(roundTwo.map((p) => p.path)).toEqual(['src/o0/other0.ts', 'src/o1/other1.ts'])
    expect(final.slice(0, 2).map((p) => p.pageId)).toEqual(roundTwo.map((p) => p.pageId))
    const roundOneSent = final.slice(2)
    expect(roundOneSent.length).toBeLessThan(first.length)
    expect(roundOneSent.map((p) => p.id)).toEqual(first.slice(0, roundOneSent.length).map((p) => p.id))
    expect(sentTokens(final)).toBeLessThanOrEqual(MAX_INPUT_TOKENS_PER_CALL)
    expect(s?.passageIdsSent).toEqual(final.map((p) => p.id))
    expect(s?.suggestedResult).toBe('yes')
  })

  it('round 2 stores only the new pieces that were sent', async () => {
    const MANY = Array.from({ length: 6 }, (_, i) => bigFile(`src/m${i}/many${i}.ts`, `manyword${i}`))
    const kit = await createKit([NULL_ANSWER], { words: ['manyword'], paths: [] })
    await judgeRepoItem(kit.ctx, {
      item: ITEM, platform: 'Social', files: [FILES[0], ...MANY], snapshot: kit.snapshot, terms: WORDS('isPrivate'), repoRepo: kit.repoRepo, meter: meterOf(),
    })
    const final = kit.calls[1].passages
    const roundTwo = (await kit.repoRepo.listPieces(kit.ctx.run.id, ITEM.id)).filter((p) => p.round === 2)
    expect(roundTwo.length).toBeLessThan(6)
    expect(final.slice(0, roundTwo.length).map((p) => p.pageId)).toEqual(roundTwo.map((p) => p.pageId))
    expect(sentTokens(final)).toBeLessThanOrEqual(MAX_INPUT_TOKENS_PER_CALL)
  })

  it('rejudge keeps the budget, round 2 first, then round 1', async () => {
    const kit = await createKit([yesQuoting('export const needle0 = true')])
    const draftOf = (f: RepoFile) => ({ path: f.path, startLine: 1, endLine: f.lines.length, code: f.lines.join('\n').slice(0, 3_800) })
    const one = await storePieces(kit.ctx, kit.repoRepo, kit.snapshot, ITEM.id, NEEDLES.slice(0, 3).map(draftOf), 1)
    const two = await storePieces(kit.ctx, kit.repoRepo, kit.snapshot, ITEM.id, NEEDLES.slice(3, 6).map(draftOf), 2)
    const pieces = await kit.repoRepo.listPieces(kit.ctx.run.id, ITEM.id)
    const s = await rejudgeRepoItem(kit.ctx, { item: ITEM, platform: 'Social', pieces, meter: meterOf() })
    const sent = kit.calls[0].passages
    expect(kit.calls).toHaveLength(1)
    expect(sentTokens(sent)).toBeLessThanOrEqual(MAX_INPUT_TOKENS_PER_CALL)
    expect(sent.slice(0, 3).map((p) => p.id)).toEqual(two.map((x) => x.passage.id))
    expect(sent.slice(3).map((p) => p.id)).toEqual(one.slice(0, sent.length - 3).map((x) => x.passage.id))
    expect(sent.length).toBeLessThan(6)
    expect(s?.passageIdsSent).toEqual(sent.map((p) => p.id))
  })
})
