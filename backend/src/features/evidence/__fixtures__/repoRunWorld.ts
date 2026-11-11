import { vi } from 'vitest'
import type { AssessedItem, AssessInput, AssessItem, AssessOutput } from '../assess.js'
import { REPO_PROMPT_VERSION } from '../config.js'
import { createMemoryRepoRepository, type MemoryRepoRepository } from '../memoryRepoRepository.js'
import { createMemoryRepository } from '../memoryRepository.js'
import { createGithubFetcher } from '../repoFetch.js'
import { runEvidenceJob } from '../runner.js'
import type { RunnerDeps } from '../runnerShared.js'
import type { EvidenceRun, RunScope, Suggestion } from '../types.js'
import { buildTarGz, fakeGithubFetch } from './fakeGithub.js'
import { fakeAudit, item, PROJECT, type FakeAudit } from './runnerWorld.js'

/** Shared setup for the repo-run tests: memory repositories, a faked GitHub, a faked search-words call and a fake judge. */
export const SHA = '0123456789abcdef0123456789abcdef01234567'
export const REPO_URL = 'https://github.com/acme/social'
export const COMMIT_URL = 'https://api.github.com/repos/acme/social/commits/HEAD'
export const ARCHIVE_URL = `https://codeload.github.com/acme/social/tar.gz/${SHA}`

export const REPO_ITEMS: AssessItem[] = [
  item('i1', 'Privacy', 'Are teen accounts private by default?'),
  item('i2', 'Reporting', 'Can users report abuse from posts?'),
  item('i3', 'Messaging', 'Can an adult stranger message a teen account?'),
]

export const REPO_FILES: Record<string, string> = {
  'src/users/createUser.ts': ['export function createUser(age: number) {', '  return {', '    isPrivate: age < 18,', '  }', '}'].join('\n'),
  'src/report/reportPost.ts': ['export function reportPost(postId: string) {', '  return queueReport(postId)', '}'].join('\n'),
  'README.md': '# Social\n',
}

/** The search words the faked AI gives for each item. */
export const TERMS: Record<string, string[]> = { i1: ['isPrivate'], i2: ['reportPost'], i3: ['strangerMessage'] }

export function judgedAs(itemId: string, over: Partial<AssessedItem> = {}): AssessedItem {
  return {
    itemId,
    suggestedResult: 'yes',
    reason: `Judged ${itemId} from the code.`,
    quotes: [],
    evidenceSufficient: true,
    conflicting: false,
    webAssessable: true,
    confidence: 'high',
    ...over,
  }
}

/** Quotes the first code line of the first passage sent (the line after the header), which verifies. */
export function quoteFirstCodeLine(input: AssessInput, tokensUsed = 100): AssessOutput {
  const first = input.passages[0]
  const line = first.text.split('\n')[1].trim()
  return { results: input.items.map((i) => judgedAs(i.id, { quotes: [{ passageId: first.id, text: line }] })), missingItemIds: [], tokensUsed }
}

export function termsReply(itemIds: string[], tokens = 50): Response {
  const content = { items: itemIds.map((id) => ({ itemId: id, words: TERMS[id] ?? [], pathHints: [] })) }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: tokens } }))
}

export interface RepoRunKit {
  repo: ReturnType<typeof createMemoryRepository>
  repoRepo: MemoryRepoRepository
  audit: FakeAudit
  deps: RunnerDeps
  /** The fetch GitHub is called with. */
  githubFetch: ReturnType<typeof vi.fn>
  /** The global fetch the search-words call goes through. */
  groqFetch: ReturnType<typeof vi.fn>
  /** The judge's answer; may throw, as a failing AI would. */
  judge: { current: (input: AssessInput) => AssessOutput }
  judged: AssessInput[]
  /** Creates a repo run and runs it. */
  run(opts?: { checkedItemIds?: string[]; capturedInRunId?: string; scope?: RunScope }): Promise<EvidenceRun>
  suggestions(runId: string): Promise<Suggestion[]>
}

export interface RepoRunKitOptions {
  items?: AssessItem[]
  files?: Record<string, string>
  /** Routes GitHub answers; defaults to the commit and the archive of `files`. */
  github?: Record<string, () => Response>
  saveSource?: boolean
}

export async function createRepoRunKit(options: RepoRunKitOptions = {}): Promise<RepoRunKit> {
  const repo = createMemoryRepository()
  const repoRepo = createMemoryRepoRepository()
  const audit = fakeAudit(options.items ?? REPO_ITEMS)
  if (options.saveSource !== false) {
    await repoRepo.saveRepoSource(PROJECT, { repoUrl: REPO_URL, owner: 'acme', name: 'social', branch: null }, 'u1')
  }
  const archive = buildTarGz(options.files ?? REPO_FILES, { topFolder: `acme-social-${SHA.slice(0, 7)}` })
  const routes = options.github ?? {
    [COMMIT_URL]: () => new Response(SHA),
    [ARCHIVE_URL]: () => new Response(archive),
  }
  const githubFetch = vi.fn(fakeGithubFetch(routes))
  const groqFetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: { content: string }[] }
    const ids = Object.keys(TERMS).filter((id) => body.messages[1].content.includes(`"itemId":"${id}"`))
    return termsReply(ids)
  })
  vi.stubGlobal('fetch', groqFetch)

  const judge = { current: (input: AssessInput) => quoteFirstCodeLine(input) }
  const judged: AssessInput[] = []
  const deps: RunnerDeps = {
    repo,
    screenshots: repo,
    audit,
    guard: { check: async () => ({ allowed: true }) },
    apiKey: 'gsk_test_secret_key',
    model: 'test-model',
    retryDelaysMs: [0, 0, 0],
    browserProvider: vi.fn(async () => {
      throw new Error('a repo run must never open a browser')
    }),
    capture: async () => {
      throw new Error('a repo run must never capture pages')
    },
    assessBatch: async (input) => {
      judged.push(input)
      return judge.current(input)
    },
    code: { repoRepo, fetcher: (guard, signal) => createGithubFetcher({ guard, signal, fetchFn: githubFetch as unknown as typeof fetch }) },
  }

  return {
    repo,
    repoRepo,
    audit,
    deps,
    githubFetch,
    groqFetch,
    judge,
    judged,
    async run(opts = {}) {
      const created = await repo.createRun({
        projectId: PROJECT,
        startedBy: 'u1',
        scope: opts.scope ?? 'all',
        capturedInRunId: opts.capturedInRunId,
        source: 'repo',
        checkedItemIds: opts.checkedItemIds ?? ['i1', 'i2'],
        promptVersion: REPO_PROMPT_VERSION,
      })
      await runEvidenceJob(created.id, deps)
      const done = await repo.getRun(created.id)
      if (!done) throw new Error('the run disappeared')
      return done
    },
    suggestions: (runId) => repo.listSuggestions(runId),
  }
}
