export type Platform =
  | 'TikTok'
  | 'Instagram'
  | 'Facebook'
  | 'Snapchat'
  | 'YouTube'
  | 'Discord'
  | 'BeReal'
  | 'X (Twitter)'

export type AuditStatus = 'draft' | 'in_progress' | 'completed' | 'under_review'

export type ChecklistItemStatus =
  | 'not_started'
  | 'compliant'
  | 'non_compliant'
  | 'not_applicable'
  | 'needs_review'

export type UserRole = 'head_auditor' | 'auditor' | 'admin'

export type SubmissionStatus = 'not_submitted' | 'pending_review' | 'approved' | 'rejected'

export type Severity = 'critical' | 'major' | 'minor'

export interface User {
  id: string
  name: string
  role: UserRole
  initials: string
  color: string
}

export interface Guideline {
  id: string
  name: string
  shortName: string
  version: string
  description: string
  source: string
  categories: string[]
  itemCount: number
  lastUpdated: string
}

export interface ChecklistItem {
  id: string
  guidelineId: string
  category: string
  feature?: string
  text: string
  description?: string
  severity: Severity
  reference?: string
}

export interface AuditProject {
  id: string
  name: string
  platform: Platform
  guidelineIds: string[]
  status: AuditStatus
  submissionStatus: SubmissionStatus
  submissionRemarks?: string
  headAuditorId: string
  auditorIds: string[]
  createdAt: string
  updatedAt: string
  dueDate?: string
  scope: string[]
  notes?: string
}

export interface AuditResponse {
  id: string
  projectId: string
  checklistItemId: string
  status: ChecklistItemStatus
  notes?: string
  auditorId: string
  updatedAt: string
}

export interface ProjectScore {
  total: number
  compliant: number
  nonCompliant: number
  notApplicable: number
  answered: number
  applicable: number
  percentage: number
  progress: number
}