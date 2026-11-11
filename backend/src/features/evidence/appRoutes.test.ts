import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { APP_NOT_CONFIGURED, wrapAccountError } from './appRoutes.js'
import type { TestAccount } from './appTypes.js'
import { decryptSecret, encryptSecret, secretAad } from './secrets.js'
import { P1, P2, TEST_SECRET_KEY, USERS, makeAudit, makeWorld, seedResult, type TestUser, type World } from './routesTestKit.js'

type Who = keyof typeof USERS

const PASSWORD = 'Teen-Pass-111'
const CIPHERTEXT = /v1\.[\w-]+\./
const ACCOUNT = {
  label: 'Teen 15',
  ageGroup: 'under_18',
  age: 15,
  loginName: 'teen15@example.com',
  password: PASSWORD,
  handles: ['@teen15'],
}

interface Seeded {
  accountId: string
  runId: string
  suggestionId: string
  pageId: string
}

let errors: MockInstance
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

/** An account saved straight to the repository, encrypted as the route would. */
async function storeAccount(world: World, projectId: string, label = 'Adult 30', key = TEST_SECRET_KEY): Promise<TestAccount> {
  const id = crypto.randomUUID()
  return world.appRepo.addTestAccount({
    id,
    projectId,
    label,
    ageGroup: 'adult',
    age: 30,
    loginName: `${label.replace(/\s/g, '').toLowerCase()}@example.com`,
    handles: ['@adult30'],
    passwordCiphertext: encryptSecret('Adult-Pass-222', key, secretAad(projectId, id)),
    createdBy: USERS.auditor.userId,
  })
}

/** A finished app run of `projectId` that checked item-1 in two steps, changed a setting and put it back. */
async function seedAppRun(world: World, projectId: string) {
  const { repo, appRepo } = world
  const run = await repo.createRun({ projectId, startedBy: 'u-aud', scope: 'all', source: 'app', checkedItemIds: ['item-1'] })
  const page = await repo.addPage(run.id, {
    url: 'https://example.com/settings',
    finalUrl: null,
    httpStatus: 200,
    accessStatus: 'ok',
    accessDetail: null,
    title: 'Settings',
    text: 'Private account',
    accessibilitySnapshot: null,
    screenshotPath: `${projectId}/${run.id}/step-1.jpg`,
    contentHash: 'h',
  })
  const base = { runId: run.id, itemId: 'item-1', accountId: null, accountLabel: 'Teen 15' }
  await appRepo.addStep({ ...base, position: 2, action: { type: 'back' }, line: 'Step 2: Teen 15 tried to post.', outcome: 'refused', refusalReason: 'Posting publicly is not allowed.', pageId: null })
  await appRepo.addStep({ ...base, position: 1, action: { type: 'toggle', ref: 'e1' }, line: 'Step 1: Teen 15 turned on Private account.', outcome: 'done', refusalReason: null, pageId: page.id })
  const change = await appRepo.addChange({ ...base, pageUrl: 'https://example.com/settings', role: 'switch', control: 'Private account', before: 'off', after: 'on', saveControl: null })
  await appRepo.updateChange(change.id, { restored: true, restoreDetail: 'Put back to off.' })
  const suggestion = await repo.addSuggestion({
    runId: run.id,
    projectId,
    itemId: 'item-1',
    suggestedResult: 'yes',
    reason: 'Step 1 shows the account can be made private.',
    confidence: 'high',
    flags: [],
    passageIdsSent: [],
    source: 'app',
    quotes: [],
  })
  const done = await repo.updateRun(run.id, { status: 'completed' })
  return { run: done, suggestion, pageId: page.id, changeId: change.id }
}

async function setup(opts: Parameters<typeof makeWorld>[0] = {}): Promise<{ world: World; seeded: Seeded }> {
  const world = makeWorld(opts)
  await world.appRepo.saveAppSource(P1, { appUrl: 'https://example.com/', loginDomains: [] }, USERS.auditor.userId)
  const account = await storeAccount(world, P1)
  const app = await seedAppRun(world, P1)
  vi.spyOn(world.repo, 'signedUrl').mockImplementation(async (path, seconds) => `https://signed.test/${path}?s=${seconds}`)
  return { world, seeded: { accountId: account.id, runId: app.run.id, suggestionId: app.suggestion.id, pageId: app.pageId } }
}

interface Endpoint {
  name: string
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  path: (s: Seeded) => string
  body?: object
  ok: number
}

const ENDPOINTS: Endpoint[] = [
  { name: 'app setup', method: 'get', path: () => `/api/projects/${P1}/app-setup`, ok: 200 },
  { name: 'save app source', method: 'put', path: () => `/api/projects/${P1}/app-source`, body: { appUrl: 'https://example.com/', loginDomains: ['www.example.com'] }, ok: 200 },
  { name: 'add account', method: 'post', path: () => `/api/projects/${P1}/test-accounts`, body: ACCOUNT, ok: 201 },
  { name: 'edit account', method: 'patch', path: (s) => `/api/projects/${P1}/test-accounts/${s.accountId}`, body: { label: 'Adult 31' }, ok: 200 },
  { name: 'remove account', method: 'delete', path: (s) => `/api/projects/${P1}/test-accounts/${s.accountId}`, ok: 204 },
  { name: 'start app run', method: 'post', path: () => `/api/projects/${P1}/app-runs`, body: { itemIds: ['item-1'] }, ok: 202 },
  { name: 'run app changes', method: 'get', path: (s) => `/api/projects/${P1}/evidence-runs/${s.runId}/app-changes`, ok: 200 },
  { name: 'suggestion steps', method: 'get', path: (s) => `/api/suggestions/${s.suggestionId}/steps`, ok: 200 },
]

const WHO: Who[] = ['head', 'auditor', 'auditorP2', 'headP2', 'admin', 'stranger']
const appPermissionMatrix = ENDPOINTS.flatMap((e) =>
  WHO.map((who) => [e.method, e.name, who, who === 'head' || who === 'auditor' ? e.ok : 403] as const),
)
const endpointNamed = (name: string): Endpoint => ENDPOINTS.find((e) => e.name === name) as Endpoint

function send(world: World, e: Endpoint, seeded: Seeded, user?: TestUser) {
  let req = request(world.app)[e.method](e.path(seeded))
  if (user) req = req.set(world.auth(user))
  return e.body === undefined ? req : req.send(e.body)
}

const addAccount = (world: World, body: object = ACCOUNT, user: TestUser = USERS.auditor) =>
  request(world.app).post(`/api/projects/${P1}/test-accounts`).set(world.auth(user)).send(body)

describe('who may use the app endpoints', () => {
  it.each(appPermissionMatrix)('%s %s as %s is %i', async (_method, name, who, status) => {
    const { world, seeded } = await setup()
    const res = await send(world, endpointNamed(name), seeded, USERS[who])
    expect(res.status).toBe(status)
  })

  it('returns 401 without a token on every new endpoint', async () => {
    const { world, seeded } = await setup()
    for (const e of ENDPOINTS) expect((await send(world, e, seeded)).status, e.name).toBe(401)
  })
})

describe('secrets stay secret', () => {
  it('no response on any endpoint contains the password or the ciphertext', async () => {
    const { world } = await setup()
    const bodies: string[] = []
    const created = await addAccount(world)
    expect(created.status).toBe(201)
    bodies.push(created.text)
    const id = created.body.account.id
    const auth = world.auth(USERS.auditor)
    bodies.push((await request(world.app).get(`/api/projects/${P1}/app-setup`).set(auth)).text)
    bodies.push((await request(world.app).patch(`/api/projects/${P1}/test-accounts/${id}`).set(auth).send({ age: 16 })).text)
    bodies.push((await request(world.app).patch(`/api/projects/${P1}/test-accounts/${id}`).set(auth).send({ password: PASSWORD })).text)
    const run = await request(world.app).post(`/api/projects/${P1}/app-runs`).set(auth).send({ itemIds: ['item-1'] })
    expect(run.status).toBe(202)
    bodies.push(run.text)
    const app = await seedAppRun(world, P1)
    bodies.push((await request(world.app).get(`/api/suggestions/${app.suggestion.id}/steps`).set(auth)).text)
    bodies.push((await request(world.app).get(`/api/projects/${P1}/evidence-runs/${app.run.id}/app-changes`).set(auth)).text)
    for (const body of bodies) {
      expect(body).not.toContain(PASSWORD)
      expect(body).not.toMatch(CIPHERTEXT)
      expect(body).not.toContain('passwordCiphertext')
    }
  })

  it('console.error never receives the password, even when the repository throws', async () => {
    const { world, seeded } = await setup()
    const leak = (input: { passwordCiphertext?: string }) =>
      Promise.reject(new Error(`row failed: ${PASSWORD} ${input.passwordCiphertext ?? ''}`))
    vi.spyOn(world.appRepo, 'addTestAccount').mockImplementation(leak)
    vi.spyOn(world.appRepo, 'updateTestAccount').mockImplementation((_id, patch) => leak(patch))
    const auth = world.auth(USERS.auditor)
    const created = await addAccount(world)
    const patched = await request(world.app).patch(`/api/projects/${P1}/test-accounts/${seeded.accountId}`).set(auth).send({ password: PASSWORD })
    const malformed = await request(world.app)
      .post(`/api/projects/${P1}/test-accounts`)
      .set(auth)
      .set('Content-Type', 'application/json')
      .send(`{"label":"x","password":"${PASSWORD}",`)
    expect([created.status, patched.status, malformed.status]).toEqual([500, 500, 400])
    for (const res of [created, patched, malformed]) expect(res.text).not.toContain(PASSWORD)
    expect(errors).toHaveBeenCalled()
    const logged = errors.mock.calls.map((args) => args.map(String).join(' ')).join('\n')
    expect(logged).not.toContain(PASSWORD)
    expect(logged).not.toMatch(CIPHERTEXT)
  })

  it('PATCH without password keeps the old ciphertext; with password re-encrypts', async () => {
    const { world } = await setup()
    const id = (await addAccount(world)).body.account.id
    const before = (await world.appRepo.getTestAccount(id)) as TestAccount
    expect(decryptSecret(before.passwordCiphertext, TEST_SECRET_KEY, secretAad(P1, id))).toBe(PASSWORD)
    const auth = world.auth(USERS.auditor)
    const renamed = await request(world.app).patch(`/api/projects/${P1}/test-accounts/${id}`).set(auth).send({ label: 'Teen 16', age: 16 })
    expect(renamed.status).toBe(200)
    expect(renamed.body.account).toMatchObject({ label: 'Teen 16', age: 16, hasPassword: true })
    const kept = (await world.appRepo.getTestAccount(id)) as TestAccount
    expect(kept.passwordCiphertext).toBe(before.passwordCiphertext)
    await request(world.app).patch(`/api/projects/${P1}/test-accounts/${id}`).set(auth).send({ password: 'New-Pass-333' })
    const after = (await world.appRepo.getTestAccount(id)) as TestAccount
    expect(after.passwordCiphertext).not.toBe(before.passwordCiphertext)
    expect(decryptSecret(after.passwordCiphertext, TEST_SECRET_KEY, secretAad(P1, id))).toBe('New-Pass-333')
  })

  it('a test-account view has exactly these keys', async () => {
    const { world } = await setup()
    const res = await addAccount(world)
    expect(Object.keys(res.body.account).sort()).toEqual(
      ['age', 'ageGroup', 'handles', 'hasPassword', 'id', 'label', 'loginName', 'updatedAt'].sort(),
    )
  })
})

describe('the app address and login domains', () => {
  const save = (world: World, body: object) =>
    request(world.app).put(`/api/projects/${P1}/app-source`).set(world.auth(USERS.auditor)).send(body)

  it('rejects an internal app address with one sentence and a bad login domain with 400', async () => {
    const { world } = await setup()
    const internal = [
      'http://intranet.test/',
      'http://10.1.2.3/',
      'http://192.168.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1/',
      'http://[::1]/',
    ]
    for (const appUrl of [...internal, 'ftp://example.com/', 'not a url', 'javascript:alert(1)']) {
      const res = await save(world, { appUrl, loginDomains: [] })
      expect(res.status, appUrl).toBe(400)
      expect(res.body).toEqual({ error: 'Use a public http or https address for the app.' })
    }
    const cases: [string[], string][] = [
      [['localhost'], 'Login domain 1 is not a host name such as accounts.example.com.'],
      [['accounts.example.com', 'com'], 'Login domain 2 is not a host name such as accounts.example.com.'],
      [['bad_host.example.com'], 'Login domain 1 is not a host name such as accounts.example.com.'],
      [['co.uk'], "Login domain 1 is a shared ending such as co.uk or github.io: enter the sign-in site's own host name."],
      [['COM.MY'], "Login domain 1 is a shared ending such as co.uk or github.io: enter the sign-in site's own host name."],
      [['github.io'], "Login domain 1 is a shared ending such as co.uk or github.io: enter the sign-in site's own host name."],
      [['10.0.0.1'], "Login domain 1 is an IP address: enter the sign-in site's host name."],
      [['amazonaws.com'], "Login domain 1 is a shared ending such as co.uk or github.io: enter the sign-in site's own host name."],
      [['compute.amazonaws.com'], "Login domain 1 is a shared ending such as co.uk or github.io: enter the sign-in site's own host name."],
      [['com.np'], "Login domain 1 is a shared ending such as co.uk or github.io: enter the sign-in site's own host name."],
      [['co.at'], "Login domain 1 is a shared ending such as co.uk or github.io: enter the sign-in site's own host name."],
      [['sso.localhost'], "Login domain 1 is a reserved or local name: enter the sign-in site's public host name."],
      [['accounts.internal'], "Login domain 1 is a reserved or local name: enter the sign-in site's public host name."],
      [['printer.local'], "Login domain 1 is a reserved or local name: enter the sign-in site's public host name."],
      [['login.example'], "Login domain 1 is a reserved or local name: enter the sign-in site's public host name."],
      [['x.home.arpa'], "Login domain 1 is a reserved or local name: enter the sign-in site's public host name."],
      [['abc.onion'], "Login domain 1 is a reserved or local name: enter the sign-in site's public host name."],
      [['sso.test'], "Login domain 1 is a reserved or local name: enter the sign-in site's public host name."],
      [['a.invalid'], "Login domain 1 is a reserved or local name: enter the sign-in site's public host name."],
      [['a.b.c.d', 'e.f', 'g.h', 'i.j', 'k.l', 'm.n'], 'Enter at most 5 login domains.'],
    ]
    for (const [loginDomains, error] of cases) {
      const res = await save(world, { appUrl: 'https://example.com/', loginDomains })
      expect(res.status, loginDomains.join()).toBe(400)
      expect(res.body).toEqual({ error })
    }
    expect((await save(world, { appUrl: 'https://example.com/', loginDomains: 'x.example.com' })).status).toBe(400)
  })

  it('refuses an app address on a shared ending or with a user name or password, and allows a tenant of one', async () => {
    const world = makeWorld({ deps: {} })
    const shared = "Use the app's own address, not a shared ending such as github.io or co.uk."
    for (const appUrl of ['https://github.io/', 'https://CO.UK/', 'https://amazonaws.com/x']) {
      const res = await save(world, { appUrl, loginDomains: [] })
      expect(res.status, appUrl).toBe(400)
      expect(res.body).toEqual({ error: shared })
    }
    for (const appUrl of ['https://user:Teen-Pass-111@example.com/', 'https://user@example.com/']) {
      const res = await save(world, { appUrl, loginDomains: [] })
      expect(res.status, appUrl).toBe(400)
      expect(res.body).toEqual({ error: 'Leave the user name and password out of the app address.' })
      expect(res.text).not.toContain('Teen-Pass-111')
    }
    expect(await world.appRepo.getAppSource(P1)).toBeNull()
  })

  it('saves the address with lower-cased, de-duplicated login domains', async () => {
    const { world } = await setup()
    const res = await save(world, { appUrl: 'https://example.com/app', loginDomains: ['Accounts.Example.com', 'accounts.example.com ', 'sso.example.co.uk'] })
    expect(res.status).toBe(200)
    expect(res.body.app).toEqual({ appUrl: 'https://example.com/app', loginDomains: ['accounts.example.com', 'sso.example.co.uk'], updatedAt: expect.any(String) })
    const setup2 = await request(world.app).get(`/api/projects/${P1}/app-setup`).set(world.auth(USERS.head))
    expect(setup2.body.app.loginDomains).toEqual(['accounts.example.com', 'sso.example.co.uk'])
    expect(setup2.body.secretKeyConfigured).toBe(true)
  })
})

describe('without EVIDENCE_SECRET_KEY', () => {
  it('test-account routes and app runs answer 503 without EVIDENCE_SECRET_KEY; app-setup still works', async () => {
    const { world, seeded } = await setup({ secretKey: null })
    for (const name of ['add account', 'start app run']) {
      const res = await send(world, endpointNamed(name), seeded, USERS.auditor)
      expect(res.status, name).toBe(503)
      expect(res.body).toEqual({ error: APP_NOT_CONFIGURED })
    }
    const withPassword = await request(world.app)
      .patch(`/api/projects/${P1}/test-accounts/${seeded.accountId}`)
      .set(world.auth(USERS.auditor))
      .send({ password: 'New-Pass-333' })
    expect(withPassword.status).toBe(503)
    expect(withPassword.body).toEqual({ error: APP_NOT_CONFIGURED })
    const res = await request(world.app).get(`/api/projects/${P1}/app-setup`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(200)
    expect(res.body.secretKeyConfigured).toBe(false)
    expect(res.body.accounts).toHaveLength(1)
    expect(world.enqueued).toHaveLength(0)
  })

  it('a PATCH with no new password works without the key and keeps the ciphertext', async () => {
    const { world, seeded } = await setup({ secretKey: null })
    const before = (await world.appRepo.getTestAccount(seeded.accountId)) as TestAccount
    const res = await request(world.app)
      .patch(`/api/projects/${P1}/test-accounts/${seeded.accountId}`)
      .set(world.auth(USERS.auditor))
      .send({ label: 'Adult 31', handles: ['@a31'] })
    expect(res.status).toBe(200)
    expect(res.body.account).toMatchObject({ label: 'Adult 31', handles: ['@a31'] })
    expect((await world.appRepo.getTestAccount(seeded.accountId))?.passwordCiphertext).toBe(before.passwordCiphertext)
  })

  it('a test account can be removed without the key, but still not during a run', async () => {
    const { world, seeded } = await setup({ secretKey: null })
    const auth = world.auth(USERS.auditor)
    const other = await storeAccount(world, P1, 'Teen 2')
    const active = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all', source: 'app' })
    const refused = await request(world.app).delete(`/api/projects/${P1}/test-accounts/${other.id}`).set(auth)
    expect(refused.status).toBe(409)
    expect(refused.body).toEqual({ error: "Test accounts can't be removed while a run is in progress." })
    await world.repo.updateRun(active.id, { status: 'failed' })
    expect((await request(world.app).delete(`/api/projects/${P1}/test-accounts/${seeded.accountId}`).set(auth)).status).toBe(204)
    expect(await world.appRepo.getTestAccount(seeded.accountId)).toBeNull()
  })

  it('the account list still loads after the key was changed', async () => {
    const first = await setup()
    const other = makeWorld({ appRepo: first.world.appRepo, secretKey: Buffer.alloc(32, 9) })
    const res = await request(other.app).get(`/api/projects/${P1}/app-setup`).set(other.auth(USERS.auditor))
    expect(res.status).toBe(200)
    expect(res.body.accounts.map((a: { label: string }) => a.label)).toEqual(['Adult 30'])
  })

  it('app runs answer 503 without the AI', async () => {
    const { world } = await setup({ aiConfigured: false })
    const res = await request(world.app).post(`/api/projects/${P1}/app-runs`).set(world.auth(USERS.auditor)).send({ itemIds: ['item-1'] })
    expect(res.status).toBe(503)
    expect(world.enqueued).toHaveLength(0)
  })
})

describe('test accounts', () => {
  it('refuses a 7th account, a duplicate label, and a delete during an active run', async () => {
    const { world, seeded } = await setup()
    expect((await addAccount(world, { ...ACCOUNT, label: 'Adult 30' })).body).toEqual({ error: 'A test account with this label already exists.' })
    for (let i = 2; i <= 6; i += 1) expect((await addAccount(world, { ...ACCOUNT, label: `Teen ${i}` })).status).toBe(201)
    const seventh = await addAccount(world, { ...ACCOUNT, label: 'Teen 7' })
    expect(seventh.status).toBe(409)
    expect(seventh.body).toEqual({ error: 'This project already has 6 test accounts.' })

    const auth = world.auth(USERS.auditor)
    const renamed = await request(world.app).patch(`/api/projects/${P1}/test-accounts/${seeded.accountId}`).set(auth).send({ label: 'Teen 2' })
    expect(renamed.status).toBe(409)
    expect(renamed.body).toEqual({ error: 'A test account with this label already exists.' })

    const active = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all', source: 'app' })
    const refused = await request(world.app).delete(`/api/projects/${P1}/test-accounts/${seeded.accountId}`).set(auth)
    expect(refused.status).toBe(409)
    expect(refused.body).toEqual({ error: "Test accounts can't be removed while a run is in progress." })
    expect(await world.appRepo.getTestAccount(seeded.accountId)).not.toBeNull()
    await world.repo.updateRun(active.id, { status: 'completed' })
    expect((await request(world.app).delete(`/api/projects/${P1}/test-accounts/${seeded.accountId}`).set(auth)).status).toBe(204)
    expect(await world.appRepo.getTestAccount(seeded.accountId)).toBeNull()
  })

  it('an account of another project is 404 on PATCH and DELETE', async () => {
    const { world } = await setup()
    const other = await storeAccount(world, P2, 'Other')
    const auth = world.auth(USERS.auditor)
    expect((await request(world.app).patch(`/api/projects/${P1}/test-accounts/${other.id}`).set(auth).send({ age: 3 })).status).toBe(404)
    expect((await request(world.app).delete(`/api/projects/${P1}/test-accounts/${other.id}`).set(auth)).status).toBe(404)
    expect((await world.appRepo.getTestAccount(other.id))?.age).toBe(30)
  })

  it('an account added without handles is stored with handles [], not its login name', async () => {
    const { world } = await setup()
    const { handles: _h, ...withoutHandles } = ACCOUNT
    const res = await addAccount(world, { ...withoutHandles, label: 'No handle' })
    expect(res.status).toBe(201)
    expect(res.body.account.handles).toEqual([])
    const stored = (await world.appRepo.getTestAccount(res.body.account.id)) as TestAccount
    expect(stored.handles).toEqual([])
    expect(stored.createdBy).toBe(USERS.auditor.userId)
    const empty = await addAccount(world, { ...ACCOUNT, label: 'Empty handles', handles: [] }, USERS.head)
    expect((await world.appRepo.getTestAccount(empty.body.account.id))?.handles).toEqual([])
    expect((await world.appRepo.getTestAccount(empty.body.account.id))?.createdBy).toBe(USERS.head.userId)
  })

  /** Makes the account list slow to read, so two requests really overlap between the check and the insert. */
  const slowList = (world: World): void => {
    const list = world.appRepo.listTestAccounts.bind(world.appRepo)
    vi.spyOn(world.appRepo, 'listTestAccounts').mockImplementation(async (projectId) => {
      const found = await list(projectId)
      await new Promise((resolve) => setTimeout(resolve, 50))
      return found
    })
  }

  it('serialises creates: two at once cannot pass 6 accounts or share a label', async () => {
    const { world } = await setup()
    for (let i = 2; i <= 5; i += 1) expect((await addAccount(world, { ...ACCOUNT, label: `Teen ${i}` })).status).toBe(201)
    slowList(world)
    const both = await Promise.all([addAccount(world, { ...ACCOUNT, label: 'Teen 6' }), addAccount(world, { ...ACCOUNT, label: 'Teen 7' })])
    expect(both.map((r) => r.status).sort()).toEqual([201, 409])
    expect((await world.appRepo.listTestAccounts(P1)).length).toBe(6)

    const fresh = (await setup()).world
    slowList(fresh)
    const same = await Promise.all([addAccount(fresh, { ...ACCOUNT, label: 'Twin' }), addAccount(fresh, { ...ACCOUNT, label: 'Twin' })])
    expect(same.map((r) => r.status).sort()).toEqual([201, 409])
    expect(same.find((r) => r.status === 409)?.body).toEqual({ error: 'A test account with this label already exists.' })
  })

  it('a duplicate label the database refuses answers the label sentence, not 500', async () => {
    const { world, seeded } = await setup()
    vi.spyOn(world.appRepo, 'listTestAccounts').mockResolvedValue([])
    const created = await addAccount(world, { ...ACCOUNT, label: 'Adult 30' })
    expect(created.status).toBe(409)
    expect(created.body).toEqual({ error: 'A test account with this label already exists.' })
    await storeAccount(world, P1, 'Teen 9')
    const patched = await request(world.app)
      .patch(`/api/projects/${P1}/test-accounts/${seeded.accountId}`)
      .set(world.auth(USERS.auditor))
      .send({ label: 'Teen 9' })
    expect(patched.status).toBe(409)
    expect(patched.body).toEqual({ error: 'A test account with this label already exists.' })
  })

  it('a rethrown repository error keeps its cause and no password in its message', () => {
    const original = Object.assign(new Error(`insert failed ${PASSWORD} v1.aaa.bbb.ccc`), { code: 'XX000' })
    const wrapped = wrapAccountError(original, [PASSWORD, 'v1.aaa.bbb.ccc'])
    expect(wrapped.message).toBe('insert failed [redacted] [redacted]')
    expect(wrapped.cause).toBe(original)
  })

  it('refuses an age that contradicts the age group, on create and on edit', async () => {
    const { world, seeded } = await setup()
    const sentence = 'The age does not match the age group: under 18 needs an age below 18, and adult an age of 18 or more.'
    for (const body of [{ ...ACCOUNT, label: 'A', ageGroup: 'under_18', age: 18 }, { ...ACCOUNT, label: 'B', ageGroup: 'adult', age: 12 }]) {
      const res = await addAccount(world, body)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: sentence })
    }
    expect((await addAccount(world, { ...ACCOUNT, label: 'C', ageGroup: 'adult', age: 18 })).status).toBe(201)
    expect((await addAccount(world, { ...ACCOUNT, label: 'D', ageGroup: 'under_18', age: null })).status).toBe(201)
    // The seeded account is an adult of 30: a new age alone, or a new group alone, is checked against the other.
    const auth = world.auth(USERS.auditor)
    const path = `/api/projects/${P1}/test-accounts/${seeded.accountId}`
    expect((await request(world.app).patch(path).set(auth).send({ age: 15 })).body).toEqual({ error: sentence })
    expect((await request(world.app).patch(path).set(auth).send({ ageGroup: 'under_18' })).body).toEqual({ error: sentence })
    expect((await request(world.app).patch(path).set(auth).send({ ageGroup: 'under_18', age: 15 })).status).toBe(200)
  })

  it('validates the account body', async () => {
    const { world } = await setup()
    const bad = [
      { ...ACCOUNT, label: '' },
      { ...ACCOUNT, label: 'x'.repeat(61) },
      { ...ACCOUNT, ageGroup: 'child' },
      { ...ACCOUNT, age: 121 },
      { ...ACCOUNT, age: 1.5 },
      { ...ACCOUNT, loginName: '' },
      { ...ACCOUNT, password: '' },
      { ...ACCOUNT, password: 'p'.repeat(201) },
      { ...ACCOUNT, handles: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { ...ACCOUNT, handles: [''] },
    ]
    for (const body of bad) {
      const res = await addAccount(world, body)
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid request' })
    }
    expect((await addAccount(world, { ...ACCOUNT, label: 'Null age', age: null })).status).toBe(201)
  })
})

describe('app runs', () => {
  const start = (world: World, body: object) =>
    request(world.app).post(`/api/projects/${P1}/app-runs`).set(world.auth(USERS.auditor)).send(body)

  it('app-runs validates itemIds and returns the start refusals with their sentences', async () => {
    const bare = makeWorld()
    expect((await start(bare, { itemIds: 'item-1' })).status).toBe(400)
    expect((await start(bare, {})).status).toBe(400)
    expect((await start(bare, { itemIds: [42] })).status).toBe(400)
    expect((await start(bare, { itemIds: ['item-1'] })).body).toEqual({ error: 'Save the app address before starting an app run.' })
    await bare.appRepo.saveAppSource(P1, { appUrl: 'https://example.com/', loginDomains: [] }, null)
    expect((await start(bare, { itemIds: ['item-1'] })).body).toEqual({ error: 'Add at least one test account before starting an app run.' })
    await storeAccount(bare, P1)
    expect((await start(bare, { itemIds: [] })).body).toEqual({ error: 'Pick at least one checklist item to check in the app.' })
    const eleven = Array.from({ length: 11 }, (_, i) => `item-${i + 1}`)
    expect((await start(bare, { itemIds: eleven })).body).toEqual({ error: 'Pick at most 10 items for one app run.' })
    expect((await start(bare, { itemIds: ['item-9'] })).body).toEqual({ error: 'One of the picked items is not on this checklist.' })
    expect(bare.enqueued).toHaveLength(0)

    const res = await start(bare, { itemIds: ['item-2', 'item-1'] })
    expect(res.status).toBe(202)
    expect(res.body.run).toMatchObject({ source: 'app', checkedItemIds: ['item-1', 'item-2'], startedBy: USERS.auditor.userId })
    expect(bare.enqueued).toEqual([res.body.run.id])
    expect((await start(bare, { itemIds: ['item-1'] })).status).toBe(409)
  })

  it('the evidence router re-assesses the unfinished of an app run with the shared app repository', async () => {
    const { world, seeded } = await setup()
    await world.repo.updateRun(seeded.runId, { checkedItemIds: ['item-1', 'item-2'] })
    await world.appRepo.addStep({ runId: seeded.runId, itemId: 'item-2', position: 1, accountId: null, accountLabel: 'Teen 15', action: { type: 'back' }, line: 'Step 1: went back.', outcome: 'done', refusalReason: null, pageId: null })
    const res = await request(world.app)
      .post(`/api/projects/${P1}/evidence-runs/${seeded.runId}/reassess`)
      .set(world.auth(USERS.auditor))
      .send({ scope: 'unfinished' })
    expect(res.status).toBe(202)
    expect(res.body.run).toMatchObject({ source: 'app', capturedInRunId: seeded.runId })
    // Without the app repository the evidence router cannot tell what is unfinished.
    const bare = makeWorld({ repo: world.repo, appRepo: world.appRepo, deps: { appRepo: undefined } })
    await world.repo.updateRun(res.body.run.id, { status: 'failed' })
    const refused = await request(bare.app)
      .post(`/api/projects/${P1}/evidence-runs/${seeded.runId}/reassess`)
      .set(bare.auth(USERS.auditor))
      .send({ scope: 'unfinished' })
    expect(refused.body).toEqual({ error: "Checking inside the app isn't configured on this server." })
  })

  it('a page run and an app run share the lock: the second is 409', async () => {
    let open: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    let calls = 0
    const base = makeAudit()
    const audit = {
      ...base,
      async getSubmissionStatus(projectId: string) {
        calls += 1
        if (calls === 1) await gate
        return base.getSubmissionStatus(projectId)
      },
    }
    const { world } = await setup({ audit })
    await world.repo.saveSource(P1, ['https://example.com/'], USERS.auditor.userId)
    const auth = world.auth(USERS.auditor)
    const first = request(world.app).post(`/api/projects/${P1}/evidence-runs`).set(auth).then((r) => r)
    await vi.waitFor(() => expect(calls).toBe(1))
    const second = await request(world.app).post(`/api/projects/${P1}/app-runs`).set(auth).send({ itemIds: ['item-1'] })
    expect(second.status).toBe(409)
    expect(second.body).toEqual({ error: 'A run is already being started for this project.' })
    open()
    expect((await first).status).toBe(202)
    expect(world.enqueued).toHaveLength(1)
  })
})

describe('recorded steps and changes', () => {
  it('returns the steps in order and the changes of a suggestion', async () => {
    const { world, seeded } = await setup()
    const res = await request(world.app).get(`/api/suggestions/${seeded.suggestionId}/steps`).set(world.auth(USERS.head))
    expect(res.status).toBe(200)
    expect(res.body.steps).toEqual([
      { id: expect.any(String), position: 1, accountLabel: 'Teen 15', line: 'Step 1: Teen 15 turned on Private account.', outcome: 'done', refusalReason: null, pageId: seeded.pageId, hasScreenshot: true, hint: false },
      { id: expect.any(String), position: 2, accountLabel: 'Teen 15', line: 'Step 2: Teen 15 tried to post.', outcome: 'refused', refusalReason: 'Posting publicly is not allowed.', pageId: null, hasScreenshot: false, hint: false },
    ])
    expect(res.body.changes).toEqual([
      { id: expect.any(String), itemId: 'item-1', accountLabel: 'Teen 15', pageUrl: 'https://example.com/settings', control: 'Private account', before: 'off', after: 'on', restored: true, restoreDetail: 'Put back to off.' },
    ])
  })

  it('steps of a carried copy come from the run that first assessed it', async () => {
    const { world, seeded } = await setup()
    const later = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all', source: 'app', checkedItemIds: ['item-2'] })
    // A decoy: the later run never checked item-1, so a step of it here must not be shown.
    await world.appRepo.addStep({ runId: later.id, itemId: 'item-1', position: 1, accountId: null, accountLabel: 'Adult 30', action: { type: 'back' }, line: 'Step 1: decoy.', outcome: 'done', refusalReason: null, pageId: null })
    const copy = await world.repo.addSuggestion({
      runId: later.id,
      projectId: P1,
      itemId: 'item-1',
      suggestedResult: 'yes',
      reason: 'Step 1 shows the account can be made private.',
      confidence: 'high',
      flags: [],
      passageIdsSent: [],
      originSuggestionId: seeded.suggestionId,
      source: 'app',
      quotes: [],
    })
    const res = await request(world.app).get(`/api/suggestions/${copy.id}/steps`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(200)
    expect(res.body.steps.map((s: { line: string }) => s.line)).toEqual([
      'Step 1: Teen 15 turned on Private account.',
      'Step 2: Teen 15 tried to post.',
    ])
    expect(res.body.changes).toHaveLength(1)
  })

  it('steps of a pages suggestion is 404', async () => {
    const { world } = await setup()
    const pages = await seedResult(world.repo, P1)
    const res = await request(world.app).get(`/api/suggestions/${pages.suggestion.id}/steps`).set(world.auth(USERS.auditor))
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'This suggestion has no recorded steps.' })
    expect((await request(world.app).get('/api/suggestions/nope/steps').set(world.auth(USERS.auditor))).status).toBe(404)
  })

  it('lists the changes of a run, and a run of another project is 404', async () => {
    const { world, seeded } = await setup()
    const auth = world.auth(USERS.auditor)
    const res = await request(world.app).get(`/api/projects/${P1}/evidence-runs/${seeded.runId}/app-changes`).set(auth)
    expect(res.body.changes).toHaveLength(1)
    const other = await seedAppRun(world, P2)
    expect((await request(world.app).get(`/api/projects/${P1}/evidence-runs/${other.run.id}/app-changes`).set(auth)).status).toBe(404)
    expect((await request(world.app).get(`/api/projects/${P1}/evidence-runs/nope/app-changes`).set(auth)).status).toBe(404)
  })

  it('a re-assess run lists the changes of the app run it judged again', async () => {
    const { world, seeded } = await setup()
    const again = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all', source: 'app', capturedInRunId: seeded.runId })
    const res = await request(world.app).get(`/api/projects/${P1}/evidence-runs/${again.id}/app-changes`).set(world.auth(USERS.auditor))
    expect(res.body.changes.map((c: { control: string }) => c.control)).toEqual(['Private account'])
  })

  it('a pages suggestion carried into an app run keeps its page link and title', async () => {
    const world = makeWorld()
    const pages = await seedResult(world.repo, P1)
    const appRun = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all', source: 'app', checkedItemIds: ['item-2'] })
    const { id: _id, runId: _run, quotes, ...rest } = pages.suggestion
    await world.repo.addSuggestion({
      ...rest,
      runId: appRun.id,
      originSuggestionId: pages.suggestion.id,
      quotes: quotes.map(({ id: _q, ...q }) => q),
    })
    await world.repo.updateRun(appRun.id, { status: 'completed' })
    const res = await request(world.app).get(`/api/projects/${P1}/ai-suggestions`).set(world.auth(USERS.auditor))
    expect(res.body.run.id).toBe(appRun.id)
    expect(res.body.suggestions[0].quotes[0]).toMatchObject({ pageId: pages.pageId, pageUrl: 'https://example.com/privacy', pageTitle: 'Privacy' })
  })

  it('a step screenshot is served by the existing page screenshot route, and another project’s is 403', async () => {
    const { world, seeded } = await setup()
    const own = await request(world.app).get(`/api/evidence/screenshots/page/${seeded.pageId}`).set(world.auth(USERS.auditor))
    expect(own.status).toBe(200)
    expect(own.body.url).toContain(`${P1}/${seeded.runId}/step-1.jpg`)
    const other = await seedAppRun(world, P2)
    expect((await request(world.app).get(`/api/evidence/screenshots/page/${other.pageId}`).set(world.auth(USERS.auditor))).status).toBe(403)
  })
})
