import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppRepository } from './appRepository.js'
import type { EvidenceRepository } from './repository.js'
import type { NewAppChange, NewAppStep, NewTestAccount } from './appTypes.js'
import { createMemoryRepository } from './memoryRepository.js'
import { createMemoryAppRepository } from './memoryAppRepository.js'
import { createSupabaseRepository } from './supabaseRepository.js'
import { createSupabaseAppRepository } from './supabaseAppRepository.js'

interface Harness {
  app: AppRepository
  runs: EvidenceRepository
  projectId: string
  itemId: string
  otherItemId: string
  cleanup: () => Promise<void>
}
type Factory = () => Harness

const memoryFactory: Factory = () => ({
  app: createMemoryAppRepository(),
  runs: createMemoryRepository(),
  projectId: randomUUID(),
  itemId: randomUUID(),
  otherItemId: randomUUID(),
  cleanup: async () => {},
})

const supabaseFactory: Factory = () => {
  const url = process.env.SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const projectId = process.env.EVIDENCE_TEST_PROJECT_ID ?? ''
  const itemId = process.env.EVIDENCE_TEST_ITEM_ID ?? ''
  const otherItemId = process.env.EVIDENCE_TEST_OTHER_ITEM_ID ?? ''
  if (!url || !key || !projectId || !itemId || !otherItemId) {
    throw new Error(
      'EVIDENCE_TEST_SUPABASE needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EVIDENCE_TEST_PROJECT_ID, EVIDENCE_TEST_ITEM_ID, EVIDENCE_TEST_OTHER_ITEM_ID',
    )
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })
  return {
    app: createSupabaseAppRepository(admin),
    runs: createSupabaseRepository(admin),
    projectId,
    itemId,
    otherItemId,
    cleanup: async () => {
      for (const table of ['Evidence_Run', 'Evidence_App_Source', 'Evidence_Test_Account']) {
        const { error } = await admin.from(table).delete().eq('projectId', projectId)
        if (error) throw new Error(`cleanup ${table}: ${error.message}`)
      }
    },
  }
}

const variants: [string, Factory][] = [['memory', memoryFactory]]
if (process.env.EVIDENCE_TEST_SUPABASE === 'true') variants.push(['supabase', supabaseFactory])

describe.each(variants)('app evidence repository (%s)', (_variant, factory) => {
  let h: Harness
  beforeEach(() => {
    h = factory()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const account = (label: string, extra: Partial<NewTestAccount> = {}): NewTestAccount => ({
    id: randomUUID(),
    projectId: h.projectId,
    label,
    ageGroup: 'under_18',
    age: 15,
    loginName: `${label.toLowerCase().replace(/\s/g, '')}@example.test`,
    handles: ['@' + label.replace(/\s/g, '')],
    passwordCiphertext: 'v1.iv.tag.cipher',
    createdBy: null,
    ...extra,
  })

  const newRunId = async () => (await h.runs.createRun({ projectId: h.projectId, startedBy: null, scope: 'all', source: 'app' })).id

  const step = (runId: string, itemId: string, position: number): NewAppStep => ({
    runId,
    itemId,
    position,
    accountId: null,
    accountLabel: 'Teen 15',
    action: { type: 'back' },
    line: `Step ${position}`,
    outcome: 'done',
    refusalReason: null,
    pageId: null,
  })

  const change = (runId: string, itemId: string, control: string): NewAppChange => ({
    runId,
    itemId,
    accountId: null,
    accountLabel: 'Teen 15',
    pageUrl: 'https://app.example/settings',
    role: 'switch',
    control,
    before: 'on',
    after: 'off',
    saveControl: null,
  })

  it('saveAppSource replaces the project app source, one row per project', async () => {
    expect(await h.app.getAppSource(h.projectId)).toBeNull()
    const first = await h.app.saveAppSource(h.projectId, { appUrl: 'https://a.example/', loginDomains: ['sso.example'] }, null)
    expect(first.projectId).toBe(h.projectId)
    const second = await h.app.saveAppSource(h.projectId, { appUrl: 'https://b.example/', loginDomains: [] }, null)
    expect(second.id).toBe(first.id)
    const got = await h.app.getAppSource(h.projectId)
    expect(got?.appUrl).toBe('https://b.example/')
    expect(got?.loginDomains).toEqual([])
  })

  it('test accounts: add, list in label order, update, delete', async () => {
    const b = await h.app.addTestAccount(account('Teen B'))
    const a = await h.app.addTestAccount(account('Adult A', { ageGroup: 'adult', age: null }))
    expect(b.createdAt).toBeTruthy()
    expect((await h.app.listTestAccounts(h.projectId)).map((x) => x.label)).toEqual(['Adult A', 'Teen B'])
    expect(await h.app.getTestAccount(a.id)).toEqual(a)
    expect(await h.app.getTestAccount(randomUUID())).toBeNull()

    const updated = await h.app.updateTestAccount(a.id, { label: 'Zed', handles: ['@z'], passwordCiphertext: 'v1.x.y.z' })
    expect(updated.label).toBe('Zed')
    expect(updated.handles).toEqual(['@z'])
    expect(updated.passwordCiphertext).toBe('v1.x.y.z')
    expect(updated.loginName).toBe(a.loginName)
    expect((await h.app.listTestAccounts(h.projectId)).map((x) => x.label)).toEqual(['Teen B', 'Zed'])

    await h.app.deleteTestAccount(b.id)
    expect((await h.app.listTestAccounts(h.projectId)).map((x) => x.id)).toEqual([a.id])
    expect(await h.app.getTestAccount(b.id)).toBeNull()
  })

  it('a second account with the same label in the project is rejected', async () => {
    await h.app.addTestAccount(account('Teen 15'))
    await expect(h.app.addTestAccount(account('Teen 15'))).rejects.toThrow()
    const other = await h.app.addTestAccount(account('Teen 16'))
    await expect(h.app.updateTestAccount(other.id, { label: 'Teen 15' })).rejects.toThrow()
    expect(await h.app.listTestAccounts(h.projectId)).toHaveLength(2)
  })

  it('listSteps returns one run’s steps for one item in position order, and all items without itemId', async () => {
    const runId = await newRunId()
    const otherRunId = await newRunId()
    await h.app.addStep(step(runId, h.itemId, 2))
    const first = await h.app.addStep(step(runId, h.itemId, 1))
    await h.app.addStep(step(runId, h.otherItemId, 1))
    await h.app.addStep(step(otherRunId, h.itemId, 1))
    expect(first.id).toBeTruthy()
    expect(first.action).toEqual({ type: 'back' })
    expect((await h.app.listSteps(runId, h.itemId)).map((s) => s.position)).toEqual([1, 2])
    const all = await h.app.listSteps(runId)
    expect(all).toHaveLength(3)
    expect(all.every((s) => s.runId === runId)).toBe(true)
  })

  it('changes: add, mark restored, list unrestored only', async () => {
    const runId = await newRunId()
    const a = await h.app.addChange(change(runId, h.itemId, 'Private account'))
    const b = await h.app.addChange(change(runId, h.itemId, 'Location'))
    await h.app.addChange(change(runId, h.otherItemId, 'Messages'))
    expect(a.restored).toBe(false)
    expect(a.restoreDetail).toBeNull()

    const restored = await h.app.updateChange(a.id, { restored: true, restoreDetail: 'put back', saveControl: 'Save' })
    expect(restored.restored).toBe(true)
    expect(restored.restoreDetail).toBe('put back')
    expect(restored.saveControl).toBe('Save')

    expect((await h.app.listChanges(runId)).length).toBe(3)
    expect((await h.app.listChanges(runId, { itemId: h.itemId })).map((c) => c.id).sort()).toEqual([a.id, b.id].sort())
    expect((await h.app.listChanges(runId, { itemId: h.itemId, unrestoredOnly: true })).map((c) => c.id)).toEqual([b.id])
    expect((await h.app.listChanges(runId, { unrestoredOnly: true })).length).toBe(2)
  })
})

describe('memory app repository', () => {
  it('returns copies, so changing a result does not change stored data', async () => {
    const app = createMemoryAppRepository()
    const projectId = randomUUID()
    const saved = await app.addTestAccount({
      id: randomUUID(),
      projectId,
      label: 'Teen 15',
      ageGroup: 'under_18',
      age: 15,
      loginName: 't@example.test',
      handles: ['@t'],
      passwordCiphertext: 'v1.a.b.c',
      createdBy: null,
    })
    saved.handles.push('@x')
    expect((await app.getTestAccount(saved.id))?.handles).toEqual(['@t'])
  })
})

describe('supabase app repository without a database', () => {
  const SECRET = 'v1.SECRETIV.SECRETTAG.SECRETCIPHERTEXT'
  const failing = (message: string) => {
    const proxy: any = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message } }).then(res)
        return () => proxy
      },
    })
    return { from: () => proxy } as unknown as SupabaseClient
  }
  const input: NewTestAccount = {
    id: randomUUID(),
    projectId: randomUUID(),
    label: 'Teen 15',
    ageGroup: 'under_18',
    age: 15,
    loginName: 'teen@example.test',
    handles: [],
    passwordCiphertext: SECRET,
    createdBy: null,
  }

  it('a Supabase error names the operation and never includes the ciphertext', async () => {
    const repo = createSupabaseAppRepository(failing(`bad row (${SECRET}) rejected`))
    const err = await repo.addTestAccount(input).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/^addTestAccount: /)
    expect((err as Error).message).not.toContain('SECRETCIPHERTEXT')
    const err2 = await repo.updateTestAccount(input.id, { passwordCiphertext: SECRET }).catch((e: Error) => e)
    expect((err2 as Error).message).toMatch(/^updateTestAccount: /)
    expect((err2 as Error).message).not.toContain('SECRETCIPHERTEXT')
  })

  it('names the operation in other database errors', async () => {
    const repo = createSupabaseAppRepository(failing('down'))
    await expect(repo.getAppSource('p')).rejects.toThrow('getAppSource: down')
    await expect(repo.listSteps('r')).rejects.toThrow('listSteps: down')
    await expect(repo.listChanges('r')).rejects.toThrow('listChanges: down')
  })
})
