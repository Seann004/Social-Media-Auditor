import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/db', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/db')>()),
  fetchAllUsers: vi.fn(),
  fetchGuidelines: vi.fn(),
  fetchUserProjects: vi.fn(),
  fetchProjectComplianceSummary: vi.fn(),
  fetchGuidelineItems: vi.fn(),
  createProject: vi.fn(),
  syncProjectMembers: vi.fn(),
  syncProjectGuidelines: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  syncProjectScope: vi.fn(),
  addProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  createChecklistItem: vi.fn(),
  toggleProjectChecklistCategory: vi.fn(),
  submitForReview: vi.fn(),
  reviewSubmission: vi.fn(),
  deleteGuideline: vi.fn(),
  createGuideline: vi.fn(),
  saveAuditFindings: vi.fn(),
  resolveDisagreement: vi.fn(),
  createUser: vi.fn(),
}))
vi.mock('../../../src/lib/crypto', () => ({ hashPassword: vi.fn(async () => 'hashed') }))

// The store first: lib/db imports the store, so loading the store first gives it the mocked lib/db.
import { calcScore, useStore } from '../../../src/store/useStore'
import * as db from '../../../src/lib/db'
import type { AuditProject, AuditResponse, ChecklistItem, Guideline } from '../../../src/types'

const m = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn)

const project = (over: Partial<AuditProject> = {}): AuditProject => ({
  id: 'p1', name: 'P', platform: 'TikTok', guidelineIds: ['g1'], status: 'in_progress', submissionStatus: 'not_submitted',
  headAuditorId: 'u1', auditorIds: ['u1', 'u2'], createdAt: '2026-01-01', updatedAt: '2026-01-01', scope: [], ...over,
})
const item = (id: string, over: Partial<ChecklistItem> = {}): ChecklistItem => ({ id, guidelineId: 'g1', category: 'Cat', text: id, severity: 'major', ...over })
const resp = (itemId: string, status: AuditResponse['status'], over: Partial<AuditResponse> = {}): AuditResponse => ({
  id: `r-${itemId}`, projectId: 'p1', checklistItemId: itemId, status, auditorId: 'u1', updatedAt: '2026-01-01', ...over,
})
const guideline = (id: string, over: Partial<Guideline> = {}): Guideline => ({
  id, name: id, shortName: id, version: '1', description: '', source: '', categories: [], itemCount: 0, lastUpdated: '', ...over,
})
const dbProject = (id: string) => ({
  projectId: id, projectTitle: `Title ${id}`, smPlatform: 'TikTok', projectStatus: 'in_progress', submissionStatus: 'not_submitted',
  submissionRemarks: null, headAuditorId: 'u1', memberIds: null, guidelineIds: null, projectNotes: null, dueDate: null,
  timeCreated: '2026-01-02T10:00:00Z', updatedAt: null,
})
const dbGuideline = (id: string, over: Record<string, unknown> = {}) => ({ guidelineId: id, guidelineName: `Name ${id}`, ...over })
const dbItem = (itemId: string, guidelineId: string) => ({ itemId, guidelineId, category: null, itemDescription: `Item ${itemId}`, severity: 'minor' })

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useStore.setState({
    isAuthenticated: true, currentUserId: 'u1', authToken: 't', sidebarCollapsed: false,
    users: [{ id: 'u1', name: 'Hana Head', role: 'head_auditor', initials: 'HH', color: '' }],
    projects: [project()], guidelines: [], checklistItems: [], responses: {}, allResponses: {}, resolutions: {},
    complianceMap: {}, projectItemCounts: {}, loading: false, dbError: null,
  })
})

describe('initFromDb', () => {
  beforeEach(() => {
    m(db.fetchAllUsers).mockResolvedValue([
      { userId: 'u2', userName: 'Andy Auditor', userEmail: '', role: 'auditor' },
      { userId: 'u3', userName: 'Odd Role', userEmail: '', role: 'visitor' as never },
    ])
    m(db.fetchGuidelines).mockResolvedValue([
      dbGuideline('gA', { shortName: 'GA', version: '3', description: 'd', source: 's', categories: ['C'], itemCount: 1, lastUpdated: '2026', isDeleted: false }),
      dbGuideline('gB'),
    ] as never)
    m(db.fetchUserProjects).mockResolvedValue([dbProject('p1'), dbProject('p2')] as never)
    m(db.fetchProjectComplianceSummary).mockResolvedValue({ p1: { percentage: 50, answered: 1, total: 2 } } as never)
    m(db.fetchGuidelineItems).mockImplementation(async (gid: string) => (gid === 'gB' ? Promise.reject(new Error('x')) : [dbItem('iA', gid)]) as never)
  })

  it('does nothing when nobody is signed in', async () => {
    useStore.setState({ currentUserId: '' })
    await useStore.getState().initFromDb()
    expect(db.fetchAllUsers).not.toHaveBeenCalled()
  })

  it('loads users, guidelines with their items, projects and the compliance summary', async () => {
    useStore.setState({
      guidelines: [guideline('pg', { projectId: 'p1' }), guideline('stale')],
      checklistItems: [item('projectItem', { guidelineId: 'pg' })],
    })
    await useStore.getState().initFromDb()
    const s = useStore.getState()
    expect(db.fetchUserProjects).toHaveBeenCalledWith('u1')
    expect(db.fetchProjectComplianceSummary).toHaveBeenCalledWith(['p1', 'p2'])
    expect(s.loading).toBe(false)
    expect(s.dbError).toBeNull()
    // The signed-in user is kept even when the user list leaves them out.
    expect(s.users.map((u) => [u.id, u.initials, u.color])).toEqual([
      ['u2', 'AA', 'bg-emerald-500'], ['u3', 'OR', 'bg-slate-500'], ['u1', 'HH', ''],
    ])
    expect(s.guidelines.map((g) => g.id)).toEqual(['pg', 'gA', 'gB'])
    expect(s.guidelines[1]).toMatchObject({ name: 'Name gA', shortName: 'GA', version: '3', itemCount: 1 })
    expect(s.guidelines[2]).toMatchObject({ shortName: 'Name gB', version: '1.0', description: '', categories: [], itemCount: 0 })
    expect(s.checklistItems.map((i) => i.id)).toEqual(['projectItem', 'iA'])
    expect(s.checklistItems[1]).toMatchObject({ category: 'General', text: 'Item iA', severity: 'minor' })
    expect(s.projects.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(s.projects[0]).toMatchObject({ name: 'Title p1', auditorIds: [], guidelineIds: [], notes: '', createdAt: '2026-01-02', updatedAt: '' })
    expect(s.complianceMap).toEqual({ p1: 50 })
    expect(s.projectItemCounts).toEqual({ p1: { answered: 1, total: 2 } })
  })

  it('keeps the error message when loading fails', async () => {
    m(db.fetchGuidelines).mockRejectedValue(new Error('Server down'))
    await useStore.getState().initFromDb()
    expect(useStore.getState()).toMatchObject({ loading: false, dbError: 'Server down' })
  })

  it('keeps a non-Error failure as text', async () => {
    m(db.fetchUserProjects).mockRejectedValue('nope')
    await useStore.getState().initFromDb()
    expect(useStore.getState().dbError).toBe('nope')
  })

  it('drops an older load when a newer one has started', async () => {
    let finishFirst!: (v: never) => void
    m(db.fetchAllUsers).mockImplementationOnce(() => new Promise((r) => { finishFirst = r }))
    const first = useStore.getState().initFromDb()
    await useStore.getState().initFromDb()
    expect(useStore.getState().users.map((u) => u.id)).toContain('u2')
    finishFirst([{ userId: 'old', userName: 'Old User', userEmail: '', role: 'auditor' }] as never)
    await first
    expect(useStore.getState().users.map((u) => u.id)).not.toContain('old')
  })

  it('does not repopulate after logout, and clears loading', async () => {
    let finish!: (v: never) => void
    m(db.fetchAllUsers).mockImplementationOnce(() => new Promise((r) => { finish = r }))
    const load = useStore.getState().initFromDb()
    useStore.getState().logout()
    finish([] as never)
    await load
    expect(useStore.getState()).toMatchObject({ projects: [], loading: false })
  })

  it('does not report the error of a load that a logout overtook', async () => {
    let fail!: (e: Error) => void
    m(db.fetchAllUsers).mockImplementationOnce(() => new Promise((_r, reject) => { fail = reject }))
    const load = useStore.getState().initFromDb()
    useStore.getState().logout()
    fail(new Error('late'))
    await load
    expect(useStore.getState()).toMatchObject({ dbError: null, loading: false })
  })
})

describe('register', () => {
  it('signs the new user in with their initials and role colour', async () => {
    m(db.createUser).mockResolvedValue({ success: true, token: 'tok' })
    useStore.setState({ users: [], isAuthenticated: false })
    await useStore.getState().register('a@x.com', 'Jane Q Smith', 'auditor', 'pw')
    const s = useStore.getState()
    expect(db.createUser).toHaveBeenCalledWith(expect.objectContaining({ userName: 'Jane Q Smith', userEmail: 'a@x.com', role: 'auditor', userPassword: 'hashed' }))
    expect(s.users[0]).toMatchObject({ initials: 'JQ', color: 'bg-emerald-500' })
    expect(s.loading).toBe(false)
  })

  it('sends no password when none is given', async () => {
    m(db.createUser).mockResolvedValue({ success: true, token: 'tok' })
    await useStore.getState().register('a@x.com', 'Jane', 'head_auditor')
    expect(m(db.createUser).mock.calls[0][0].userPassword).toBeUndefined()
  })

  it('keeps the error, stops loading and rethrows when the server refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m(db.createUser).mockRejectedValue(new Error('duplicate'))
    await expect(useStore.getState().register('a@x.com', 'Jane', 'auditor', 'pw')).rejects.toThrow('duplicate')
    expect(useStore.getState()).toMatchObject({ loading: false, dbError: 'duplicate' })
    m(db.createUser).mockRejectedValue('plain')
    await expect(useStore.getState().register('a@x.com', 'Jane', 'auditor', 'pw')).rejects.toBe('plain')
    expect(useStore.getState().dbError).toBe('plain')
  })
})

describe('login and the sidebar', () => {
  it('replaces the stored profile of a user who logs in again', () => {
    useStore.getState().login('u1', 'Hana New', 'admin', 'tok')
    expect(useStore.getState().users).toEqual([{ id: 'u1', name: 'Hana New', role: 'admin', initials: 'HN', color: 'bg-blue-600' }])
  })

  it('toggles the sidebar and persists it', () => {
    useStore.getState().toggleSidebar()
    expect(useStore.getState().sidebarCollapsed).toBe(true)
    expect(JSON.parse(localStorage.getItem('safetyaudit-session') ?? '{}').state.sidebarCollapsed).toBe(true)
    useStore.getState().toggleSidebar()
    expect(useStore.getState().sidebarCollapsed).toBe(false)
  })
})

describe('project actions', () => {
  it('createProject creates, adds the head auditor once to the members, syncs guidelines and reloads projects', async () => {
    m(db.createProject).mockResolvedValue('p9')
    m(db.fetchUserProjects).mockResolvedValue([dbProject('p9')] as never)
    const id = await useStore.getState().createProject({ name: 'N', platform: 'X', guidelineIds: ['g1'], auditorIds: ['u2', 'u1'], notes: 'n' })
    expect(id).toBe('p9')
    expect(db.createProject).toHaveBeenCalledWith({ title: 'N', platform: 'X', headAuditorId: 'u1', notes: 'n', dueDate: undefined, status: 'in_progress' })
    expect(db.syncProjectMembers).toHaveBeenCalledWith('p9', ['u1', 'u2'])
    expect(db.syncProjectGuidelines).toHaveBeenCalledWith('p9', ['g1'])
    expect(useStore.getState().projects.map((p) => p.id)).toEqual(['p9'])
  })

  it('createProject copes with no project list coming back', async () => {
    m(db.createProject).mockResolvedValue('p9')
    m(db.fetchUserProjects).mockResolvedValue(undefined as never)
    await useStore.getState().createProject({ name: 'N', platform: 'X', guidelineIds: [], auditorIds: [] })
    expect(useStore.getState().projects).toEqual([])
  })

  it('updateProject sends only the changed fields and updates the project', async () => {
    useStore.setState({ projects: [project(), project({ id: 'p2' })] })
    await useStore.getState().updateProject('p1', { name: 'New', platform: 'YouTube', status: 'completed', notes: '', dueDate: '2026-05-01' })
    expect(db.updateProject).toHaveBeenCalledWith('p1', { projectTitle: 'New', smPlatform: 'YouTube', projectStatus: 'completed', projectNotes: '', dueDate: '2026-05-01' })
    const [p1, p2] = useStore.getState().projects
    expect(p1).toMatchObject({ name: 'New', status: 'completed', dueDate: '2026-05-01' })
    expect(p1.updatedAt).not.toBe('2026-01-01')
    expect(p2.name).toBe('P')
    await useStore.getState().updateProject('p1', {})
    expect(m(db.updateProject).mock.calls[1][1]).toEqual({})
  })

  it('deleteProject removes the project', async () => {
    await useStore.getState().deleteProject('p1')
    expect(db.deleteProject).toHaveBeenCalledWith('p1')
    expect(useStore.getState().projects).toEqual([])
  })

  it('syncProjectGuidelines and syncProjectScope update that project only', async () => {
    useStore.setState({ projects: [project(), project({ id: 'p2' })] })
    await useStore.getState().syncProjectGuidelines('p1', ['g2'])
    await useStore.getState().syncProjectScope('p1', ['Chat'])
    expect(db.syncProjectGuidelines).toHaveBeenCalledWith('p1', ['g2'])
    expect(db.syncProjectScope).toHaveBeenCalledWith('p1', ['Chat'])
    expect(useStore.getState().projects[0]).toMatchObject({ guidelineIds: ['g2'], scope: ['Chat'] })
    expect(useStore.getState().projects[1]).toMatchObject({ guidelineIds: ['g1'], scope: [] })
  })

  it('addAuditorToProject adds a member once', async () => {
    useStore.setState({ projects: [project(), project({ id: 'p2' })] })
    await useStore.getState().addAuditorToProject('p1', 'u3')
    await useStore.getState().addAuditorToProject('p1', 'u3')
    expect(db.addProjectMember).toHaveBeenCalledWith('p1', 'u3')
    expect(useStore.getState().projects[0].auditorIds).toEqual(['u1', 'u2', 'u3'])
    expect(useStore.getState().projects[1].auditorIds).toEqual(['u1', 'u2'])
  })

  it('removeAuditorFromProject removes the member', async () => {
    useStore.setState({ projects: [project(), project({ id: 'p2' })] })
    await useStore.getState().removeAuditorFromProject('p1', 'u2')
    expect(db.removeProjectMember).toHaveBeenCalledWith('p1', 'u2')
    expect(useStore.getState().projects[0].auditorIds).not.toContain('u2')
    expect(useStore.getState().projects[1].auditorIds).toEqual(['u1', 'u2'])
  })

  // BUG (useStore.ts:448): removing one auditor also drops the head auditor from the local member list,
  // although the server only removes that one member (members include the head; see createProject). Until
  // a reload, the dashboard's team counts miss the head. Remove `.fails` once only the removed user is dropped.
  it('removeAuditorFromProject keeps the head auditor as a member', async () => {
    await useStore.getState().removeAuditorFromProject('p1', 'u2')
    expect(useStore.getState().projects[0].auditorIds).toEqual(['u1'])
  })

  it('submitForReview and reviewSubmission move the project through review', async () => {
    useStore.setState({ projects: [project(), project({ id: 'p2' })] })
    await useStore.getState().submitForReview('p1')
    expect(db.submitForReview).toHaveBeenCalledWith('p1')
    expect(useStore.getState().projects[0]).toMatchObject({ submissionStatus: 'pending_review', status: 'under_review' })
    await useStore.getState().reviewSubmission('p1', false, 'Fix item 3')
    expect(db.reviewSubmission).toHaveBeenCalledWith('p1', false, 'Fix item 3')
    expect(useStore.getState().projects[0]).toMatchObject({ submissionStatus: 'rejected', status: 'in_progress', submissionRemarks: 'Fix item 3' })
    await useStore.getState().reviewSubmission('p1', true, 'Good')
    expect(useStore.getState().projects[0]).toMatchObject({ submissionStatus: 'approved', status: 'completed' })
    expect(useStore.getState().projects[1].status).toBe('in_progress')
  })
})

describe('checklist and guideline actions', () => {
  beforeEach(() => {
    useStore.setState({ checklistItems: [item('i1'), item('i2', { guidelineId: 'g2' })], guidelines: [guideline('g1'), guideline('g2')] })
  })

  it('updateChecklistItem saves and updates the item', async () => {
    await useStore.getState().updateChecklistItem('i1', { text: 'New', severity: 'critical' })
    expect(db.updateChecklistItem).toHaveBeenCalledWith('i1', { itemDescription: 'New', severity: 'critical', category: undefined })
    expect(useStore.getState().checklistItems[0]).toMatchObject({ text: 'New', severity: 'critical' })
    expect(useStore.getState().checklistItems[1].text).toBe('i2')
  })

  it('deleteChecklistItem removes the item', async () => {
    await useStore.getState().deleteChecklistItem('i1')
    expect(useStore.getState().checklistItems.map((i) => i.id)).toEqual(['i2'])
  })

  it('addChecklistItem stores the new item under the id the server gives', async () => {
    m(db.createChecklistItem).mockResolvedValue('i3')
    const input = { category: 'C', text: 'T', severity: 'minor' as const, guidelineId: 'g1', itemCode: 'X1' }
    await useStore.getState().addChecklistItem('p1', input)
    expect(db.createChecklistItem).toHaveBeenCalledWith('p1', input)
    expect(useStore.getState().checklistItems[2]).toMatchObject({ id: 'i3', text: 'T', itemCode: 'X1' })
  })

  it('toggleProjectChecklistCategory passes the change to the server', async () => {
    await useStore.getState().toggleProjectChecklistCategory('p1', { category: 'C', enabled: false, guidelineId: 'g1' })
    expect(db.toggleProjectChecklistCategory).toHaveBeenCalledWith('p1', { category: 'C', enabled: false, guidelineId: 'g1' })
  })

  it('deleteGuideline removes it and its items', async () => {
    await useStore.getState().deleteGuideline('g2')
    expect(db.deleteGuideline).toHaveBeenCalledWith('g2')
    expect(useStore.getState().guidelines.map((g) => g.id)).toEqual(['g1'])
    expect(useStore.getState().checklistItems.map((i) => i.id)).toEqual(['i1'])
  })

  it('addSyntheticGuideline saves the guideline and items as the current user and puts them first', async () => {
    const g = guideline('g9', { name: 'Nine', categories: ['C'] })
    const items = [item('n1', { guidelineId: 'g9', reference: 'R', helpText: 'H' })]
    await useStore.getState().addSyntheticGuideline(g, items)
    expect(db.createGuideline).toHaveBeenCalledWith({
      guideline: expect.objectContaining({ guidelineId: 'g9', guidelineName: 'Nine', categories: ['C'], userId: 'u1' }),
      items: [expect.objectContaining({ id: 'n1', text: 'n1', reference: 'R', helpText: 'H' })],
    })
    expect(useStore.getState().guidelines[0].id).toBe('g9')
    expect(useStore.getState().checklistItems[0].id).toBe('n1')
  })

  it('addSyntheticGuideline adds nothing when the save fails', async () => {
    m(db.createGuideline).mockRejectedValue(new Error('db'))
    await expect(useStore.getState().addSyntheticGuideline(guideline('g9'), [])).rejects.toThrow('db')
    expect(useStore.getState().guidelines.map((g) => g.id)).toEqual(['g1', 'g2'])
  })
})

describe('answer actions', () => {
  it('saveFindings saves and updates an existing answer, and leaves a missing one alone', async () => {
    useStore.setState({ responses: { p1__i1: resp('i1', 'compliant') } })
    await useStore.getState().saveFindings('p1', 'i1', 'Seen')
    expect(db.saveAuditFindings).toHaveBeenCalledWith('p1', 'i1', 'u1', 'Seen')
    expect(useStore.getState().responses.p1__i1.findings).toBe('Seen')
    const before = useStore.getState().responses
    await useStore.getState().saveFindings('p1', 'i9', 'x')
    expect(useStore.getState().responses).toBe(before)
  })

  it('resolveDisagreement records the resolution, shows the resolved result and refreshes the score', async () => {
    useStore.setState({
      allResponses: { p1__i1: [resp('i1', 'compliant'), resp('i1', 'non_compliant', { auditorId: 'u2', updatedAt: '2026-01-02' })] },
      responses: { p1__i1: resp('i1', 'needs_review') },
    })
    m(db.fetchProjectComplianceSummary).mockResolvedValue({ p1: { percentage: 100, answered: 1, total: 1 } } as never)
    await useStore.getState().resolveDisagreement('p1', 'i1', 'compliant', 'agreed')
    expect(db.resolveDisagreement).toHaveBeenCalledWith('p1', 'i1', 'compliant', 'agreed')
    const s = useStore.getState()
    expect(s.resolutions.p1__i1).toMatchObject({ status: 'compliant', resolvedBy: 'u1', notes: 'agreed' })
    expect(s.responses.p1__i1).toMatchObject({ status: 'compliant', auditorId: 'u2' })
    expect(s.complianceMap.p1).toBe(100)
    expect(s.projectItemCounts.p1).toEqual({ answered: 1, total: 1 })
  })

  it('resolveDisagreement with no answers stored keeps the responses and an unknown summary', async () => {
    m(db.fetchProjectComplianceSummary).mockResolvedValue({} as never)
    await useStore.getState().resolveDisagreement('p1', 'i1', 'not_applicable')
    expect(useStore.getState().responses).toEqual({})
    expect(useStore.getState().resolutions.p1__i1.notes).toBe('')
    expect(useStore.getState().complianceMap).toEqual({})
  })
})

describe('scores', () => {
  const responses = {
    p1__a: resp('a', 'compliant'),
    p1__b: resp('b', 'partially'),
    p1__c: resp('c', 'non_compliant'),
    p1__d: resp('d', 'not_applicable'),
    p1__e: resp('e', 'needs_review'),
    p1__f: resp('f', 'not_started'),
  }
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => item(id, { category: id < 'd' ? 'First' : 'Second' }))

  it('calcScore weighs partial answers as half and leaves out N/A and unanswered items', () => {
    expect(calcScore(items, responses, 'p1')).toEqual({
      total: 7, compliant: 1, nonCompliant: 2, notApplicable: 1, answered: 4, applicable: 3, percentage: 50, progress: 57,
    })
  })

  it('calcScore is zero for no items', () => {
    expect(calcScore([], {}, 'p1')).toMatchObject({ total: 0, percentage: 0, progress: 0 })
  })

  it('getProjectScore and getCategoryScore use the project\'s guidelines', () => {
    useStore.setState({ checklistItems: [...items, item('x', { guidelineId: 'other' })], responses })
    expect(useStore.getState().getProjectScore('p1')).toMatchObject({ total: 7, percentage: 50 })
    expect(useStore.getState().getCategoryScore('p1', 'First')).toMatchObject({ total: 3, compliant: 1, nonCompliant: 2, percentage: 50 })
    expect(useStore.getState().getCategoryScore('p1', 'Second')).toMatchObject({ total: 4, answered: 1, applicable: 0, percentage: 0 })
  })

  it('returns an empty score for an unknown project', () => {
    expect(useStore.getState().getProjectScore('nope')).toMatchObject({ total: 0, answered: 0 })
    expect(useStore.getState().getCategoryScore('nope', 'First')).toMatchObject({ total: 0 })
  })
})
