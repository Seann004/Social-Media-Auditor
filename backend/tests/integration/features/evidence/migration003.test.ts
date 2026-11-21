import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sql = readFileSync(
  fileURLToPath(new URL('../../../../supabase/migrations/003_repo_evidence.sql', import.meta.url)),
  'utf8',
)

// the SQL without its `--` comment lines
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

describe('003_repo_evidence.sql', () => {
  it('creates the three repo tables, each idempotent with row level security', () => {
    const tables = [...sql.matchAll(/create table if not exists "(\w+)"/gi)].map((m) => m[1])
    expect(tables).toEqual(['Evidence_Repo_Source', 'Evidence_Repo_Snapshot', 'Evidence_Repo_Piece'])
    for (const t of tables) expect(sql).toContain(`alter table "${t}" enable row level security`)
  })

  it.each([['Evidence_Run'], ['AI_Suggestion']])('replaces the source check on %s to allow repo', (table) => {
    expect(sql).toContain(`alter table "${table}" drop constraint if exists "${table}_source_check"`)
    expect(sql).toMatch(
      new RegExp(String.raw`alter table "${table}"\s+add constraint "${table}_source_check" check \("source" in \('pages','app','repo'\)\)`),
    )
  })

  it('drops no table and grants nothing, least of all to anon', () => {
    expect(sql).not.toMatch(/drop table/i)
    expect(code).not.toMatch(/\bgrant\b/i)
    expect(code).not.toMatch(/\banon\b/i)
  })

  it('checks a piece round is 1 or 2 and indexes runId and itemId', () => {
    expect(sql).toMatch(/"round" integer not null check \("round" in \(1, ?2\)\)/)
    expect(sql).toMatch(/on "Evidence_Repo_Piece"\("runId", "itemId"\)/)
  })

  it('starts with a pre-check that names Evidence_App_Source', () => {
    expect(sql.slice(0, 800)).toMatch(/PRE-CHECK/)
    expect(sql.slice(0, 800)).toContain('Evidence_App_Source')
  })
})
