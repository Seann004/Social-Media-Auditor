import { describe, expect, it } from 'vitest'
import { createAuditData, type AuditDb } from './auditData.js'

interface Row {
  [key: string]: unknown
}

/** A just-enough Supabase client: from().select().eq()...eq().maybeSingle(). */
function fakeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = []
      const query = {
        select: () => query,
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return query
        },
        async maybeSingle() {
          const row = (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v))
          return { data: row ?? null, error: null }
        },
      }
      return query
    },
  } as never
}

const db: AuditDb = {
  fetchProjectChecklistItems: async () => [
    {
      itemId: 'i1',
      guidelineId: 'g1',
      category: 'Privacy',
      itemDescription: 'Are accounts private?',
      severity: 'major',
      reference: '1.1',
      itemName: 'Private accounts',
      itemCode: null,
      rowType: null,
      helpText: 'Check defaults',
      verbatimClauseText: null,
      answerOptions: null,
    },
  ],
  fetchAuditResults: async () => [
    {
      resultId: 'r1',
      projectId: 'p1',
      itemId: 'i1',
      userId: 'u1',
      guidelineId: 'g1',
      result: 'compliant',
      notes: 'n',
      findings: null,
      evidenceImages: null,
      timeSubmitted: 't',
    },
  ],
}

describe('createAuditData', () => {
  it('maps checklist items and answers into the shapes the runner uses', async () => {
    const audit = createAuditData({ db: async () => db, client: () => fakeClient({}) })

    expect(await audit.listChecklistItems('p1')).toEqual([
      { id: 'i1', guidelineId: 'g1', category: 'Privacy', name: 'Private accounts', text: 'Are accounts private?', helpText: 'Check defaults' },
    ])
    expect(await audit.listAnswers('p1')).toEqual([
      { itemId: 'i1', userId: 'u1', guidelineId: 'g1', result: 'compliant', notes: 'n', findings: null, evidenceImages: [] },
    ])
  })

  it('reads access: the head auditor of the project, an assigned auditor, and nobody else', async () => {
    const audit = createAuditData({
      db: async () => db,
      client: () =>
        fakeClient({
          Audit_Project: [{ projectId: 'p1', headAuditorId: 'head' }],
          Project_Member: [
            { projectId: 'p1', userId: 'aud' },
            { projectId: 'p1', userId: 'adm' },
          ],
        }),
    })

    expect(await audit.getProjectAccess('p1', 'head', 'head_auditor')).toBe('head_auditor')
    expect(await audit.getProjectAccess('p1', 'other', 'head_auditor')).toBeNull()
    expect(await audit.getProjectAccess('p1', 'aud', 'auditor')).toBe('auditor')
    expect(await audit.getProjectAccess('p1', 'stranger', 'auditor')).toBeNull()
    expect(await audit.getProjectAccess('p1', 'head', 'admin')).toBeNull()
    // An admin is no member of the audit, even if a membership row exists for them.
    expect(await audit.getProjectAccess('p1', 'adm', 'admin')).toBeNull()
  })

  it('reads the platform and submission status from the project, and null when the project is gone', async () => {
    const audit = createAuditData({
      db: async () => db,
      client: () => fakeClient({ Audit_Project: [{ projectId: 'p1', smPlatform: 'TikTok', submissionStatus: 'pending_review' }] }),
    })

    expect(await audit.getPlatform('p1')).toBe('TikTok')
    expect(await audit.getSubmissionStatus('p1')).toBe('pending_review')
    expect(await audit.getSubmissionStatus('gone')).toBeNull()
    await expect(audit.getPlatform('gone')).rejects.toThrow(/project/i)
  })

  it('says so when the service key is missing, only when it is used', async () => {
    const audit = createAuditData({ db: async () => db, client: () => null })
    await expect(audit.getProjectAccess('p1', 'u', 'auditor')).rejects.toThrow(/service/i)
  })
})
