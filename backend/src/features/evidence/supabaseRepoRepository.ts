import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_READ_PAGE_SIZE } from './config.js'
import type { RepoRepository } from './repoRepository.js'
import type { RepoPiece, RepoSnapshot, RepoSource } from './repoTypes.js'
import { dbCall, dbInsert } from './supabaseRetry.js'

interface DbResult<T> {
  data: T | null
  error: { message: string; code?: string } | null
}

// Rows use the same camelCase names as our types; only nullable columns need mapping.
type Row = Record<string, any>

/** Throws with the operation name. */
function unwrap<T>(op: string, res: DbResult<T>): T | null {
  if (res.error) throw new Error(`${op}: ${res.error.message}`)
  return res.data
}

function required<T>(op: string, res: DbResult<T>): NonNullable<T> {
  const data = unwrap(op, res)
  if (data === null || data === undefined) throw new Error(`${op}: no row returned`)
  return data as NonNullable<T>
}

const toSource = (row: Row): RepoSource => ({
  ...(row as RepoSource),
  branch: row.branch ?? null,
  updatedBy: row.updatedBy ?? null,
})

const toSnapshot = (row: Row): RepoSnapshot => ({ ...(row as RepoSnapshot), branch: row.branch ?? null })

/** The position column only orders rows; it is not part of RepoPiece. */
const toPiece = (row: Row): RepoPiece => {
  const { position: _position, ...piece } = row
  return piece as RepoPiece
}

export function createSupabaseRepoRepository(admin: SupabaseClient): RepoRepository {
  return {
    async getRepoSource(projectId) {
      const row = unwrap(
        'getRepoSource',
        await admin.from('Evidence_Repo_Source').select('*').eq('projectId', projectId).maybeSingle(),
      )
      return row ? toSource(row) : null
    },
    async saveRepoSource(projectId, input, userId) {
      const row = required(
        'saveRepoSource',
        await admin
          .from('Evidence_Repo_Source')
          .upsert(
            {
              projectId,
              repoUrl: input.repoUrl,
              owner: input.owner,
              name: input.name,
              branch: input.branch,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            },
            { onConflict: 'projectId' },
          )
          .select('*')
          .single(),
      )
      return toSource(row)
    },

    async saveSnapshot(input) {
      const row = required(
        'saveSnapshot',
        await dbCall('saveSnapshot', () =>
          admin
            .from('Evidence_Repo_Snapshot')
            .upsert({ ...input, createdAt: new Date().toISOString() }, { onConflict: 'runId' })
            .select('*')
            .single(),
        ),
      )
      return toSnapshot(row)
    },
    async getSnapshot(runId) {
      const res = await admin.from('Evidence_Repo_Snapshot').select('*').eq('runId', runId).maybeSingle()
      // An id that is not a uuid cannot match a row.
      if (res.error?.code === '22P02') return null
      const row = unwrap('getSnapshot', res)
      return row ? toSnapshot(row) : null
    },

    async addPieces(input) {
      if (input.length === 0) return []
      // Each piece gets the next free position in its run, so calls never interleave.
      const last = unwrap(
        'addPieces',
        await admin
          .from('Evidence_Repo_Piece')
          .select('position')
          .eq('runId', input[0].runId)
          .order('position', { ascending: false })
          .limit(1),
      )
      const start = last && last.length > 0 ? Number(last[0].position) + 1 : 0
      const rows = input.map((p, i) => ({ ...p, id: randomUUID(), position: start + i }))
      const ids = rows.map((r) => r.id)
      const saved =
        unwrap(
          'addPieces',
          await dbInsert(
            'addPieces',
            () => admin.from('Evidence_Repo_Piece').insert(rows).select('*'),
            () => admin.from('Evidence_Repo_Piece').select('*').in('id', ids),
          ),
        ) ?? []
      return [...saved].sort((a, b) => a.position - b.position).map(toPiece)
    },
    async listPieces(runId, itemId) {
      const rows: Row[] = []
      for (let from = 0; ; from += SUPABASE_READ_PAGE_SIZE) {
        let query = admin.from('Evidence_Repo_Piece').select('*').eq('runId', runId)
        if (itemId !== undefined) query = query.eq('itemId', itemId)
        const page =
          unwrap(
            'listPieces',
            await query
              .order('round', { ascending: true })
              .order('position', { ascending: true })
              .order('id', { ascending: true })
              .range(from, from + SUPABASE_READ_PAGE_SIZE - 1),
          ) ?? []
        rows.push(...page)
        if (page.length < SUPABASE_READ_PAGE_SIZE) return rows.map(toPiece)
      }
    },
  }
}
