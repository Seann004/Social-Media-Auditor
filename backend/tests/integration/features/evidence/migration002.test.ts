import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sql = readFileSync(
  fileURLToPath(new URL('../../../../supabase/migrations/002_app_evidence.sql', import.meta.url)),
  'utf8',
)

// statements: the SQL with `--` comment lines removed, split on ';', trimmed
const statements = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

const alterAdding = (table: string, column: string) =>
  statements.filter((s) => s.startsWith(`alter table "${table}"`) && s.includes(`"${column}"`))

describe('002_app_evidence.sql', () => {
  it('creates exactly the four app tables, each with row level security', () => {
    const tables = [...sql.matchAll(/create table if not exists "(\w+)"/gi)].map((m) => m[1])
    expect(tables).toEqual(['Evidence_App_Source', 'Evidence_Test_Account', 'Evidence_App_Step', 'Evidence_App_Change'])
    for (const t of tables) expect(sql).toContain(`alter table "${t}" enable row level security`)
  })

  it('is additive only: no drop, no alter column, no dropped or replaced constraint', () => {
    expect(sql).not.toMatch(/\bdrop\b/i)
    expect(sql).not.toMatch(/alter column/i)
    expect(sql).not.toMatch(/create or replace/i)
  })

  it('every added column is idempotent and either nullable or defaulted', () => {
    for (const [line] of sql.matchAll(/add column[^\n,;]*/gi)) {
      expect(line).toMatch(/add column if not exists/i)
      if (/not null/i.test(line)) expect(line).toMatch(/default/i)
    }
  })

  it.each([['Evidence_Run'], ['AI_Suggestion']])('one alter statement on %s adds source, defaulting to pages', (table) => {
    const [statement, ...others] = alterAdding(table, 'source')
    expect(others).toEqual([])
    expect(statement).toMatch(/add column if not exists "source" text not null default 'pages'/)
  })

  it.each([['checkedItemIds'], ['uncheckedItemIds'], ['currentItemId'], ['currentStep']])('an alter statement on Evidence_Run adds %s', (column) => {
    expect(alterAdding('Evidence_Run', column)).toHaveLength(1)
  })

  it('records who created a test account, nullable and set null when the user goes', () => {
    expect(sql).toMatch(/"createdBy" uuid references "User"\("userId"\) on delete set null/)
  })

  it('stores only a password ciphertext, never a plain password column', () => {
    expect(sql).toMatch(/"passwordCiphertext" text not null/)
    expect(sql).not.toMatch(/"password" /)
  })

  it('grants nothing to anon and starts with the pre-check', () => {
    expect(sql).not.toMatch(/grant [^;]* to anon/i)
    expect(sql.slice(0, 600)).toMatch(/PRE-CHECK/)
  })
})
