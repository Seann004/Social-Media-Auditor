import type { Row } from '../helpers/fakeSupabase.js'

// One small audit world for the core route and database service tests, seeded into the fake Supabase tables.
// Ids are UUIDs because the project access middleware only accepts UUID project and item ids.

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const U = {
  admin: id(1),
  head: id(2),
  headOther: id(3),
  aud: id(4),
  aud2: id(5),
  outsider: id(6),
} as const

/** Projects: P is open (members aud and aud2), LOCKED is under review, OTHER belongs to another head auditor. */
export const P = id(21)
export const LOCKED = id(22)
export const OTHER = id(23)

/** The library guideline G, its project clone PG in P, and LG in LOCKED. */
export const G = id(11)
export const PG = id(12)
export const LG = id(13)
export const G2 = id(14)

export const GI1 = id(31)
export const GI2 = id(32)
export const PI1 = id(41)
export const PI2 = id(42)
export const LI1 = id(43)
export const OI1 = id(44)

export function coreWorld(): Record<string, Row[]> {
  return {
    User: [
      { userId: U.admin, userName: 'Ada Admin', userEmail: 'admin@example.test', role: 'admin' },
      { userId: U.head, userName: 'Hana Head', userEmail: 'head@example.test', role: 'head_auditor' },
      { userId: U.headOther, userName: 'Omar Other', userEmail: 'other@example.test', role: 'head_auditor' },
      { userId: U.aud, userName: 'Ali Auditor', userEmail: 'aud@example.test', role: 'auditor' },
      { userId: U.aud2, userName: 'Bea Auditor', userEmail: 'aud2@example.test', role: 'auditor' },
      { userId: U.outsider, userName: 'Out Sider', userEmail: 'out@example.test', role: 'auditor' },
    ],
    Audit_Project: [
      { projectId: P, projectTitle: 'TikTok 2026', smPlatform: 'TikTok', projectStatus: 'draft', submissionStatus: 'not_submitted', submissionRemarks: null, headAuditorId: U.head, projectNotes: null, dueDate: null, timeCreated: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { projectId: LOCKED, projectTitle: 'Discord review', smPlatform: 'Discord', projectStatus: 'under_review', submissionStatus: 'pending_review', submissionRemarks: null, headAuditorId: U.head, projectNotes: null, dueDate: null, timeCreated: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
      { projectId: OTHER, projectTitle: 'Snapchat audit', smPlatform: 'Snapchat', projectStatus: 'in_progress', submissionStatus: 'not_submitted', submissionRemarks: null, headAuditorId: U.headOther, projectNotes: null, dueDate: null, timeCreated: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' },
    ],
    Project_Member: [
      { projectId: P, userId: U.aud, User: { userName: 'Ali Auditor', role: 'auditor' } },
      { projectId: P, userId: U.aud2, User: { userName: 'Bea Auditor', role: 'auditor' } },
      { projectId: LOCKED, userId: U.aud, User: { userName: 'Ali Auditor', role: 'auditor' } },
    ],
    Guideline: [
      { guidelineId: G, guidelineName: 'Online Safety Code', shortName: 'OSC', version: '1', description: 'Library', source: 'Gov', categories: ['Age', 'Privacy'], lastUpdated: '2026-01-01', userId: U.admin, projectId: null, originalGuidelineId: null },
      { guidelineId: G2, guidelineName: 'Design Code', shortName: 'DC', version: '2', description: 'Library two', source: 'ICO', categories: ['Privacy'], lastUpdated: '2026-01-02', userId: U.admin, projectId: null, originalGuidelineId: null },
      { guidelineId: PG, guidelineName: 'Online Safety Code', shortName: 'OSC', version: '1', description: 'Library', source: 'Gov', categories: ['Age', 'Privacy'], lastUpdated: '2026-01-01', projectId: P, originalGuidelineId: G },
      { guidelineId: LG, guidelineName: 'Online Safety Code', shortName: 'OSC', version: '1', description: 'Library', source: 'Gov', categories: ['Age'], lastUpdated: '2026-01-01', projectId: LOCKED, originalGuidelineId: G },
    ],
    Checklist: [
      { checklistId: 'gcl', guidelineId: G, projectId: null },
      { checklistId: 'gcl2', guidelineId: G2, projectId: null },
      { checklistId: 'pcl', guidelineId: PG, projectId: P },
      { checklistId: 'lcl', guidelineId: LG, projectId: LOCKED },
    ],
    Checklist_Item: [
      { itemId: GI1, checklistId: 'gcl', category: 'Age', itemDescription: 'Age checks stop under-13 sign-ups', severity: 'critical', reference: 'Clause 2' },
      { itemId: GI2, checklistId: 'gcl', category: 'Privacy', itemDescription: 'Child accounts are private by default', severity: 'major', reference: 'Clause 10' },
      { itemId: PI1, checklistId: 'pcl', originalItemId: GI1, category: 'Age', itemDescription: 'Age checks stop under-13 sign-ups', severity: 'critical', reference: 'Clause 2' },
      { itemId: PI2, checklistId: 'pcl', originalItemId: GI2, category: 'Privacy', itemDescription: 'Child accounts are private by default', severity: 'major', reference: 'Clause 10' },
      { itemId: LI1, checklistId: 'lcl', originalItemId: GI1, category: 'Age', itemDescription: 'Age checks stop under-13 sign-ups', severity: 'critical', reference: 'Clause 2' },
    ],
    Audit_Result: [],
    Checklist_Resolution: [],
    Project_Scope: [],
    Audit_Report: [],
    Item_Mapping: [],
    Suggestion_Decision: [],
  }
}

/** An answer row as the database stores it. */
export function answer(projectId: string, itemId: string, userId: string, result: string, guidelineId = PG): Row {
  return { resultId: `r-${projectId.slice(-2)}-${itemId.slice(-2)}-${userId.slice(-2)}`, projectId, itemId, userId, guidelineId, result, notes: null, findings: null, timeSubmitted: '2026-04-01T00:00:00Z' }
}
