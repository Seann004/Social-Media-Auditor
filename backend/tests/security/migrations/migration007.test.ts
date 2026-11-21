import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sql = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/007_lock_public_access.sql', import.meta.url)),
  'utf8',
)

// the SQL without its `--` comment lines
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

describe('007_lock_public_access.sql (security finding S-0)', () => {
  it('enables row level security on every table in the public schema, not a fixed list', () => {
    expect(code).toMatch(/from pg_tables\s+where schemaname = 'public'/i)
    expect(code).toMatch(/alter table public\.%I enable row level security/i)
  })

  it('drops every existing policy that lets the anon or authenticated role in', () => {
    expect(code).toMatch(/from pg_policies/i)
    expect(code).toMatch(/'anon' = any\(roles\)/)
    expect(code).toMatch(/'authenticated' = any\(roles\)/)
    expect(code).toMatch(/'public' = any\(roles\)/)
    expect(code).toMatch(/drop policy %I on public\.%I/i)
  })

  it('revokes table rights from the public roles', () => {
    expect(code).toMatch(/revoke all on all tables in schema public from anon, authenticated/i)
    expect(code).toMatch(/revoke all on all sequences in schema public from anon, authenticated/i)
  })

  it('keeps only read access to Guideline for the browser, which listens for new guidelines', () => {
    expect(code).toMatch(/grant select on "Guideline" to anon/i)
    expect(code).toMatch(/create policy "anon_read_guidelines" on "Guideline"\s+for select to anon using \(true\)/i)
    // no other table is opened to anon
    const anonGrants = [...code.matchAll(/grant [a-z, ]+ on "?(\w+)"? to anon/gi)].map((m) => m[1])
    expect(anonGrants).toEqual(['Guideline'])
    const anonPolicies = [...code.matchAll(/create policy "\w+" on "(\w+)"[\s\S]*?to anon/gi)].map((m) => m[1])
    expect(anonPolicies).toEqual(['Guideline'])
  })

  it('takes the login check away from the public roles, so it can only be called through the rate-limited backend', () => {
    expect(code).toMatch(/proname = 'verify_user_login'/)
    expect(code).toMatch(/revoke all on function %s from public, anon, authenticated/i)
    expect(code).toMatch(/grant execute on function %s to service_role/i)
  })

  it('drops no table and deletes no data', () => {
    expect(code).not.toMatch(/drop table/i)
    expect(code).not.toMatch(/\bdelete from\b/i)
    expect(code).not.toMatch(/\btruncate\b/i)
  })

  it('runs in one transaction so it applies completely or not at all', () => {
    expect(code.trim()).toMatch(/^begin;/i)
    expect(code.trim()).toMatch(/commit;$/i)
  })
})
