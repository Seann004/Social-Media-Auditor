import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRepoRepository, type MemoryRepoRepository } from '../../../../src/features/evidence/memoryRepoRepository.js'
import { createRepoRouter } from '../../../../src/features/evidence/repoRoutes.js'
import { createProjectLock } from '../../../../src/features/evidence/routeSupport.js'
import { P1, P2, USERS, makeWorld, seedResult, type World } from '../../../../src/features/evidence/routesTestKit.js'

const URL_OK = 'https://github.com/octo/safe-app'
const BAD_ADDRESS = 'Enter a public GitHub repository address, like https://github.com/owner/name.'
const BAD_BRANCH = "That branch name isn't valid."

interface RepoWorld extends World {
  repoRepo: MemoryRepoRepository
  api: express.Express
}

function setup(opts: { aiConfigured?: boolean } = {}): RepoWorld {
  const world = makeWorld({ aiConfigured: opts.aiConfigured })
  const repoRepo = createMemoryRepoRepository()
  const api = express()
  api.use(
    '/api',
    createRepoRouter({
      repo: world.repo,
      repoRepo,
      audit: world.audit,
      queue: world.queue,
      sessions: world.sessions,
      acquire: createProjectLock(),
      aiConfigured: opts.aiConfigured ?? true,
    }),
  )
  return { ...world, repoRepo, api }
}

/** A finished repo run of P1 with two pieces for item-1 (one quoted) and one for item-2. */
async function seedRepoRun(w: RepoWorld) {
  const run = await w.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all', source: 'repo', checkedItemIds: ['item-1', 'item-2'] })
  await w.repoRepo.saveSnapshot({
    runId: run.id,
    repoUrl: URL_OK,
    owner: 'octo',
    name: 'safe-app',
    branch: null,
    commitSha: 'abc1234def',
    filesRead: 3,
    filesSkipped: 0,
    truncated: false,
  })
  const make = async (itemId: string, path: string, round: 1 | 2, code: string) => {
    const url = `${URL_OK}/blob/abc1234def/${path}#L1-L2`
    const page = await w.repo.addPage(run.id, {
      url, finalUrl: url, httpStatus: null, accessStatus: 'ok', accessDetail: null, title: 'h',
      text: `File ${path}, lines 1–2\n${code}`, accessibilitySnapshot: null, screenshotPath: null, contentHash: 'h',
    })
    const [piece] = await w.repoRepo.addPieces([
      { runId: run.id, itemId, pageId: page.id, path, startLine: 1, endLine: 2, commitSha: 'abc1234def', round },
    ])
    return { page, piece }
  }
  const quoted = await make('item-1', 'src/age.ts', 1, 'if (age < 18) block()')
  const other = await make('item-1', 'src/other.ts', 2, 'noop()')
  await make('item-2', 'src/x.ts', 1, 'elsewhere()')
  const suggestion = await w.repo.addSuggestion({
    runId: run.id, projectId: P1, itemId: 'item-1', suggestedResult: 'yes', reason: 'r', confidence: 'high', flags: [],
    passageIdsSent: [], source: 'repo',
    quotes: [{ passageId: null, pageId: quoted.page.id, quoteText: 'age < 18', verified: true, highlightScreenshotPath: null }],
  })
  await w.repo.updateRun(run.id, { status: 'completed' })
  return { run, suggestion, quoted, other }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('repo source', () => {
  it('lets an auditor save and read it back, with the address normalised', async () => {
    const w = setup()
    const put = await request(w.api).put(`/api/projects/${P1}/repo-source`).set(w.auth(USERS.auditor)).send({ repoUrl: ` ${URL_OK}.git/ `, branch: 'main' })
    expect(put.status).toBe(200)
    expect(put.body.repo).toMatchObject({ repoUrl: URL_OK, branch: 'main' })
    const get = await request(w.api).get(`/api/projects/${P1}/repo-source`).set(w.auth(USERS.auditor))
    expect(get.body.repo).toMatchObject({ repoUrl: URL_OK, branch: 'main' })
    expect(Object.keys(get.body.repo).sort()).toEqual(['branch', 'repoUrl', 'updatedAt'])
  })

  it('reads null before anything is saved, and stores no branch as null', async () => {
    const w = setup()
    expect((await request(w.api).get(`/api/projects/${P1}/repo-source`).set(w.auth(USERS.head))).body).toEqual({ repo: null })
    const put = await request(w.api).put(`/api/projects/${P1}/repo-source`).set(w.auth(USERS.head)).send({ repoUrl: URL_OK, branch: '' })
    expect(put.body.repo.branch).toBeNull()
  })

  it.each([
    ['not a url', 'hello'],
    ['another host', 'https://gitlab.com/a/b'],
    ['http', 'http://github.com/a/b'],
    ['a path inside the repo', 'https://github.com/a/b/tree/main'],
    ['too long', `https://github.com/a/${'b'.repeat(3000)}`],
  ])('refuses a bad address (%s) with its sentence', async (_n, repoUrl) => {
    const w = setup()
    const res = await request(w.api).put(`/api/projects/${P1}/repo-source`).set(w.auth(USERS.auditor)).send({ repoUrl })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(BAD_ADDRESS)
  })

  it('refuses a missing address body', async () => {
    const w = setup()
    const res = await request(w.api).put(`/api/projects/${P1}/repo-source`).set(w.auth(USERS.auditor)).send({})
    expect(res.body.error).toBe(BAD_ADDRESS)
  })

  it.each(['a..b', '-x', 'a b', 'x.lock', '/x'])('refuses the bad branch %j with its sentence', async (branch) => {
    const w = setup()
    const res = await request(w.api).put(`/api/projects/${P1}/repo-source`).set(w.auth(USERS.auditor)).send({ repoUrl: URL_OK, branch })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(BAD_BRANCH)
  })

  it('answers 401 without a session, 403 to a user of another project and to an admin', async () => {
    const w = setup()
    expect((await request(w.api).get(`/api/projects/${P1}/repo-source`)).status).toBe(401)
    for (const who of [USERS.auditorP2, USERS.headP2, USERS.admin, USERS.stranger]) {
      const res = await request(w.api).put(`/api/projects/${P1}/repo-source`).set(w.auth(who)).send({ repoUrl: URL_OK })
      expect(res.status).toBe(403)
    }
    expect(await w.repoRepo.getRepoSource(P1)).toBeNull()
  })

  it('lets a user of another project act on their own project only', async () => {
    const w = setup()
    expect((await request(w.api).put(`/api/projects/${P2}/repo-source`).set(w.auth(USERS.auditorP2)).send({ repoUrl: URL_OK })).status).toBe(200)
    expect(await w.repoRepo.getRepoSource(P1)).toBeNull()
  })
})

describe('repo runs', () => {
  it('lets a head auditor start a run: 202 and queued', async () => {
    const w = setup()
    await w.repoRepo.saveRepoSource(P1, { repoUrl: URL_OK, owner: 'octo', name: 'safe-app', branch: null }, null)
    const res = await request(w.api).post(`/api/projects/${P1}/repo-runs`).set(w.auth(USERS.head)).send({ itemIds: ['item-1'] })
    expect(res.status).toBe(202)
    expect(res.body.run).toMatchObject({ source: 'repo' })
    expect(w.enqueued).toEqual([res.body.run.id])
  })

  it('passes on the refusal of startRepoRun', async () => {
    const w = setup()
    const res = await request(w.api).post(`/api/projects/${P1}/repo-runs`).set(w.auth(USERS.auditor)).send({ itemIds: ['item-1'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Save the repository address before starting a code run.')
    expect(w.enqueued).toEqual([])
  })

  it('answers 503 as the app route does when the AI is not configured', async () => {
    const w = setup({ aiConfigured: false })
    const res = await request(w.api).post(`/api/projects/${P1}/repo-runs`).set(w.auth(USERS.head)).send({ itemIds: ['item-1'] })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('AI assessment is not configured on this server: GROQ_API_KEY is missing.')
  })

  it('refuses a bad body and another project', async () => {
    const w = setup()
    expect((await request(w.api).post(`/api/projects/${P1}/repo-runs`).set(w.auth(USERS.head)).send({ itemIds: 'x' })).status).toBe(400)
    expect((await request(w.api).post(`/api/projects/${P1}/repo-runs`).set(w.auth(USERS.auditorP2)).send({ itemIds: ['item-1'] })).status).toBe(403)
  })
})

describe('suggestion code', () => {
  it('lists the pieces of the item with quoted set only on the quoted one', async () => {
    const w = setup()
    const { suggestion, quoted, other } = await seedRepoRun(w)
    const res = await request(w.api).get(`/api/suggestions/${suggestion.id}/code`).set(w.auth(USERS.auditor))
    expect(res.status).toBe(200)
    expect(res.body.commitSha).toBe('abc1234def')
    expect(res.body.repoUrl).toBe(URL_OK)
    expect(res.body.pieces).toEqual([
      { id: quoted.piece.id, path: 'src/age.ts', startLine: 1, endLine: 2, code: 'if (age < 18) block()', url: quoted.page.url, round: 1, quoted: true },
      { id: other.piece.id, path: 'src/other.ts', startLine: 1, endLine: 2, code: 'noop()', url: other.page.url, round: 2, quoted: false },
    ])
  })

  it('answers null commit and address when the snapshot is missing', async () => {
    const w = setup()
    const { suggestion, run } = await seedRepoRun(w)
    w.repoRepo.removeRun(run.id)
    const res = await request(w.api).get(`/api/suggestions/${suggestion.id}/code`).set(w.auth(USERS.head))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ commitSha: null, repoUrl: null, pieces: [] })
  })

  it('answers 404 for a pages suggestion', async () => {
    const w = setup()
    const { suggestion } = await seedResult(w.repo, P1)
    expect((await request(w.api).get(`/api/suggestions/${suggestion.id}/code`).set(w.auth(USERS.auditor))).status).toBe(404)
  })

  it('answers 404 for an unknown suggestion and 403 to a user without access', async () => {
    const w = setup()
    const { suggestion } = await seedRepoRun(w)
    expect((await request(w.api).get('/api/suggestions/nope/code').set(w.auth(USERS.auditor))).status).toBe(404)
    expect((await request(w.api).get(`/api/suggestions/${suggestion.id}/code`).set(w.auth(USERS.auditorP2))).status).toBe(403)
  })
})
