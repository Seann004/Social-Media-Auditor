/**
 * One repeat of a code case: the synthetic repository served from memory by the faked GitHub (no
 * internet), in-memory repositories and the real run pipeline (runEvidenceJob), with the given judge
 * metered by the budget. The search-words call is the pipeline's own real Groq call.
 */
import { REPO_GITHUB_HOSTS, REPO_PROMPT_VERSION } from '../src/features/evidence/config.js'
import { createMemoryRepoRepository } from '../src/features/evidence/memoryRepoRepository.js'
import { createMemoryRepository } from '../src/features/evidence/memoryRepository.js'
import { createGithubFetcher } from '../src/features/evidence/repoFetch.js'
import { headerOf } from '../src/features/evidence/repoJudge.js'
import { runEvidenceJob } from '../src/features/evidence/runner.js'
import type { RunnerDeps } from '../src/features/evidence/runnerShared.js'
import type { UrlGuard } from '../src/features/evidence/urlGuard.js'
import { buildTarGz, fakeGithubFetch } from '../src/features/evidence/__fixtures__/fakeGithub.js'
import { REPO_FILES } from './repoFixture.js'
import type { BenchmarkCase, RepeatRecord } from './types.js'
import { benchmarkAudit, createRun, finishedRun, installGroqGate, itemOf, meteredAssess, PROJECT_ID, recordOf, type RepeatContext } from './world.js'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const OWNER = 'acme'
const NAME = 'social'
const COMMIT_URL = `https://api.github.com/repos/${OWNER}/${NAME}/commits/HEAD`
const ARCHIVE_URL = `https://codeload.github.com/${OWNER}/${NAME}/tar.gz/${SHA}`

/** Lets through GitHub's two hosts over https and nothing else, without looking anything up. */
const githubOnly: UrlGuard = {
  check: async (url) => {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && REPO_GITHUB_HOSTS.includes(parsed.hostname)
      ? { allowed: true }
      : { allowed: false, reason: 'The benchmark reaches only the faked GitHub.' }
  },
}

const never = (what: string) => async (): Promise<never> => {
  throw new Error(`a code run never ${what}`)
}

export async function runRepoRepeat(c: BenchmarkCase, repeat: number, ctx: RepeatContext): Promise<RepeatRecord> {
  const repo = createMemoryRepository()
  const repoRepo = createMemoryRepoRepository()
  const item = itemOf(c)
  await repoRepo.saveRepoSource(PROJECT_ID, { repoUrl: `https://github.com/${OWNER}/${NAME}`, owner: OWNER, name: NAME, branch: null }, null)
  const archive = new Uint8Array(buildTarGz(REPO_FILES, { topFolder: `${OWNER}-${NAME}-${SHA.slice(0, 7)}` }))
  const fetchFn = fakeGithubFetch({ [COMMIT_URL]: () => new Response(SHA), [ARCHIVE_URL]: () => new Response(archive) })

  const deps: RunnerDeps = {
    repo,
    screenshots: repo,
    audit: benchmarkAudit(item),
    guard: githubOnly,
    apiKey: ctx.apiKey,
    model: ctx.model,
    browserProvider: never('opens a browser'),
    capture: never('captures pages'),
    assessBatch: meteredAssess(ctx.ai.assessBatch, ctx.budget),
    code: { repoRepo, fetcher: (guard, signal) => createGithubFetcher({ guard, signal, fetchFn }) },
  }
  // No run starts once the cap is reached; within the run, every request to Groq is checked and counted at the gate.
  ctx.budget.assertOpen()
  const created = await createRun(repo, c, REPO_PROMPT_VERSION)
  const started = Date.now()
  const restoreFetch = installGroqGate(ctx.budget)
  try {
    await runEvidenceJob(created.id, deps)
  } finally {
    restoreFetch()
  }
  const seconds = (Date.now() - started) / 1000
  const { run, suggestion } = await finishedRun(repo, created.id, item.id)
  const pieces = await repoRepo.listPieces(created.id, item.id)
  const lines = pieces.map((p) => `${headerOf(p.path, p.startLine, p.endLine)}${p.round === 2 ? ' (second search)' : ''}`)
  return recordOf(c, repeat, { run, suggestion, steps: null, lines, seconds })
}
