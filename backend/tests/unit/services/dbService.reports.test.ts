import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failNext, resetTables, tables } from '../../helpers/fakeSupabase.js'
import { answer, coreWorld, LG, LI1, LOCKED, OTHER, P, U } from '../../fixtures/coreWorld.js'

vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

const db = await import('../../../src/services/dbService.js')

beforeEach(() => {
  resetTables(coreWorld())
  tables.Audit_Report.push({ reportId: 'rep-locked', projectId: LOCKED, userId: U.head, timeGenerated: '2026-06-15T00:00:00Z' })
})
afterEach(() => vi.restoreAllMocks())

describe('fetchAuditReports', () => {
  it('answers the reports of the user\'s projects with the head auditor name, guidelines and score', async () => {
    tables.Audit_Result.push(answer(LOCKED, LI1, U.aud, 'compliant', LG))
    const reports = await db.fetchAuditReports(U.aud)
    expect(reports).toEqual([expect.objectContaining({
      projectId: LOCKED, projectTitle: 'Discord review', headAuditorName: 'Hana Head', guidelineIds: [LG], scorePercentage: 100, timeCreated: '2026-06-15T00:00:00Z',
    })])
  })

  it('answers [] for a user without projects or without reports', async () => {
    expect(await db.fetchAuditReports(U.outsider)).toEqual([])
    expect(await db.fetchAuditReports(U.headOther)).toEqual([])
  })

  it('creates the missing report of a submitted project', async () => {
    tables.Audit_Project.find((p) => p.projectId === OTHER)!.submissionStatus = 'approved'
    const reports = await db.fetchAuditReports(U.headOther)
    expect(reports.map((r) => r.projectId)).toEqual([OTHER])
    expect(tables.Audit_Report.find((r) => r.projectId === OTHER)).toMatchObject({ userId: U.headOther })
  })

  it('logs a failed backfill and still answers the other reports', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    tables.Audit_Project.find((p) => p.projectId === P)!.submissionStatus = 'rejected'
    failNext('Audit_Report', 'upsert', { message: 'denied' })
    const reports = await db.fetchAuditReports(U.head)
    expect(reports.map((r) => r.projectId)).toEqual([LOCKED])
    expect(error).toHaveBeenCalledWith('Audit_Report backfill failed:', { message: 'denied' })
  })

  it('names an unknown head auditor "Unknown"', async () => {
    tables.User = tables.User.filter((u) => u.userId !== U.head)
    expect((await db.fetchAuditReports(U.head))[0].headAuditorName).toBe('Unknown')
  })

  it('filters by status, by title or platform text, and by date range', async () => {
    tables.Audit_Project.find((p) => p.projectId === P)!.submissionStatus = 'pending_review'
    tables.Audit_Report.push({ reportId: 'rep-p', projectId: P, userId: U.head, timeGenerated: '2026-03-01T00:00:00Z' })
    const ids = async (filters: Parameters<typeof db.fetchAuditReports>[1]) => (await db.fetchAuditReports(U.head, filters)).map((r) => r.projectId).sort()

    expect(await ids({})).toEqual([P, LOCKED].sort())
    expect(await ids({ projectStatusFilter: 'under_review' })).toEqual([LOCKED])
    expect(await ids({ search: 'TIKTOK' })).toEqual([P])
    expect(await ids({ search: 'discord' })).toEqual([LOCKED])
    expect(await ids({ dateFrom: '2026-04-01' })).toEqual([LOCKED])
    expect(await ids({ dateTo: '2026-04-01' })).toEqual([P])
    expect(await ids({ dateFrom: '2026-01-01', dateTo: '2026-12-31', search: 'review' })).toEqual([LOCKED])
  })

  it('throws when a read fails', async () => {
    for (const table of ['Project_Member', 'Audit_Project', 'Audit_Report', 'User', 'Guideline']) {
      failNext(table, 'select')
      await expect(db.fetchAuditReports(U.head)).rejects.toBeTruthy()
    }
  })
})

describe('createAuditReport', () => {
  it('answers the new report id, and throws for a project that already has one', async () => {
    const reportId = await db.createAuditReport(P, U.aud)
    expect(tables.Audit_Report.find((r) => r.reportId === reportId)).toMatchObject({ projectId: P, userId: U.aud })
    await expect(db.createAuditReport(P, U.aud)).rejects.toMatchObject({ code: '23505' })
  })
})
