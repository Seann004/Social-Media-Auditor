import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sql = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/001_evidence_assessment.sql', import.meta.url)),
  'utf8',
)

describe('001_evidence_assessment.sql', () => {
  it('enables row level security on every table it creates', () => {
    const tables = [...sql.matchAll(/create table(?: if not exists)? "(\w+)"/gi)].map((m) => m[1])
    expect(tables.length).toBe(8)
    for (const t of tables) expect(sql).toContain(`alter table "${t}" enable row level security`)
  })

  it('never makes the bucket public or grants the anon role', () => {
    expect(sql).toMatch(/'evidence-screenshots',\s*'evidence-screenshots',\s*false/)
    expect(sql).not.toMatch(/grant [^;]* to anon/i)
  })
})
