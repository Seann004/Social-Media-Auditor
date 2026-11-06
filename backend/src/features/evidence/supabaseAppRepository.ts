import type { SupabaseClient } from '@supabase/supabase-js'
import { byLabel } from './accountOrder.js'
import type { AppRepository } from './appRepository.js'
import type { AppChange, AppSource, AppStep, TestAccount } from './appTypes.js'

interface DbResult<T> {
  data: T | null
  error: { message: string; code?: string } | null
}

/** Postgres: invalid text representation, as when an id that is not a uuid is compared with a uuid column. */
const INVALID_TEXT_REPRESENTATION = '22P02'

// Rows use the same camelCase names as our types; only nullable columns need mapping.
type Row = Record<string, any>

/** Throws with the operation name. A message never carries a password ciphertext sent with the call. */
function unwrap<T>(op: string, res: DbResult<T>, secrets: string[] = []): T | null {
  if (!res.error) return res.data
  let message = res.error.message
  for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]')
  throw new Error(`${op}: ${message}`)
}

function required<T>(op: string, res: DbResult<T>, secrets: string[] = []): NonNullable<T> {
  const data = unwrap(op, res, secrets)
  if (data === null || data === undefined) throw new Error(`${op}: no row returned`)
  return data as NonNullable<T>
}

const toSource = (row: Row): AppSource => ({
  ...(row as AppSource),
  loginDomains: row.loginDomains ?? [],
  updatedBy: row.updatedBy ?? null,
})

const toAccount = (row: Row): TestAccount => ({
  ...(row as TestAccount),
  age: row.age ?? null,
  handles: row.handles ?? [],
  createdBy: row.createdBy ?? null,
})

const toStep = (row: Row): AppStep => ({
  ...(row as AppStep),
  accountId: row.accountId ?? null,
  accountLabel: row.accountLabel ?? null,
  refusalReason: row.refusalReason ?? null,
  pageId: row.pageId ?? null,
})

const toChange = (row: Row): AppChange => ({
  ...(row as AppChange),
  accountId: row.accountId ?? null,
  saveControl: row.saveControl ?? null,
  restoreDetail: row.restoreDetail ?? null,
})

export function createSupabaseAppRepository(admin: SupabaseClient): AppRepository {
  return {
    async getAppSource(projectId) {
      const row = unwrap(
        'getAppSource',
        await admin.from('Evidence_App_Source').select('*').eq('projectId', projectId).maybeSingle(),
      )
      return row ? toSource(row) : null
    },
    async saveAppSource(projectId, input, userId) {
      const row = required(
        'saveAppSource',
        await admin
          .from('Evidence_App_Source')
          .upsert(
            { projectId, appUrl: input.appUrl, loginDomains: input.loginDomains, updatedBy: userId, updatedAt: new Date().toISOString() },
            { onConflict: 'projectId' },
          )
          .select('*')
          .single(),
      )
      return toSource(row)
    },

    async listTestAccounts(projectId) {
      const rows = unwrap(
        'listTestAccounts',
        await admin.from('Evidence_Test_Account').select('*').eq('projectId', projectId).order('label', { ascending: true }),
      )
      return (rows ?? []).map(toAccount).sort(byLabel)
    },
    async getTestAccount(id) {
      const res = await admin.from('Evidence_Test_Account').select('*').eq('id', id).maybeSingle()
      if (res.error?.code === INVALID_TEXT_REPRESENTATION) return null
      const row = unwrap('getTestAccount', res)
      return row ? toAccount(row) : null
    },
    async addTestAccount(input) {
      const row = required(
        'addTestAccount',
        await admin.from('Evidence_Test_Account').insert(input).select('*').single(),
        [input.passwordCiphertext],
      )
      return toAccount(row)
    },
    async updateTestAccount(id, patch) {
      const row = required(
        'updateTestAccount',
        await admin
          .from('Evidence_Test_Account')
          .update({ ...patch, updatedAt: new Date().toISOString() })
          .eq('id', id)
          .select('*')
          .single(),
        patch.passwordCiphertext ? [patch.passwordCiphertext] : [],
      )
      return toAccount(row)
    },
    async deleteTestAccount(id) {
      unwrap('deleteTestAccount', await admin.from('Evidence_Test_Account').delete().eq('id', id))
    },

    async addStep(input) {
      const row = required('addStep', await admin.from('Evidence_App_Step').insert(input).select('*').single())
      return toStep(row)
    },
    async listSteps(runId, itemId) {
      let q = admin.from('Evidence_App_Step').select('*').eq('runId', runId)
      if (itemId !== undefined) q = q.eq('itemId', itemId)
      const rows = unwrap('listSteps', await q.order('position', { ascending: true }).order('createdAt', { ascending: true }))
      return (rows ?? []).map(toStep)
    },

    async addChange(input) {
      const row = required('addChange', await admin.from('Evidence_App_Change').insert(input).select('*').single())
      return toChange(row)
    },
    async updateChange(id, patch) {
      const row = required(
        'updateChange',
        await admin.from('Evidence_App_Change').update(patch).eq('id', id).select('*').single(),
      )
      return toChange(row)
    },
    async listChanges(runId, opts = {}) {
      let q = admin.from('Evidence_App_Change').select('*').eq('runId', runId)
      if (opts.itemId !== undefined) q = q.eq('itemId', opts.itemId)
      if (opts.unrestoredOnly) q = q.eq('restored', false)
      const rows = unwrap('listChanges', await q.order('createdAt', { ascending: true }).order('id', { ascending: true }))
      return (rows ?? []).map(toChange)
    },
  }
}
