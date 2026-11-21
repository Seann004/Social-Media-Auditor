import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failNext, resetTables, tables } from '../../helpers/fakeSupabase.js'
import { coreWorld, id, LOCKED, OTHER, P, PG, U } from '../../fixtures/coreWorld.js'

vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

// sendAssignmentEmail posts to Brevo with https.request: every call lands here instead of the network.
const https = vi.hoisted(() => ({
  sent: [] as { options: any; body: string }[],
  status: 201,
  fail: null as Error | null,
}))
vi.mock('https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('https')>()
  const request = (options: any, onResponse: (res: any) => void) => {
    const req = new EventEmitter() as any
    let body = ''
    req.write = (chunk: string) => { body += chunk }
    req.end = () => {
      https.sent.push({ options, body })
      if (https.fail) { req.emit('error', https.fail); return }
      const res = new EventEmitter() as any
      res.statusCode = https.status
      onResponse(res)
      res.emit('data', '{"ok":true}')
      res.emit('end')
    }
    return req
  }
  return { ...actual, default: { ...(actual as any).default, request }, request }
})

const db = await import('../../../src/services/dbService.js')

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  resetTables(coreWorld())
  https.sent.length = 0
  https.status = 201
  https.fail = null
  process.env.BREVO_API_KEY = 'test-brevo-key'
  process.env.BREVO_SENDER_EMAIL = 'audit@example.test'
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  delete process.env.BREVO_API_KEY
  delete process.env.BREVO_SENDER_EMAIL
  vi.restoreAllMocks()
})

const members = (projectId: string) => tables.Project_Member.filter((m) => m.projectId === projectId).map((m) => m.userId).sort()

describe('fetchUserProjects', () => {
  it('answers projects led by the user or shared with them, with members and guidelines', async () => {
    const forAud = await db.fetchUserProjects(U.aud)
    expect(forAud.map((p) => p.projectId).sort()).toEqual([P, LOCKED].sort())
    expect(forAud.find((p) => p.projectId === P)).toMatchObject({ guidelineIds: [PG], memberIds: [U.aud, U.aud2] })

    const forOther = await db.fetchUserProjects(U.headOther)
    expect(forOther.map((p) => p.projectId)).toEqual([OTHER])
    expect(forOther[0]).toMatchObject({ memberIds: [], guidelineIds: [] })
    expect(await db.fetchUserProjects(U.outsider)).toEqual([])
  })

  it('throws when a read fails', async () => {
    for (const table of ['Project_Member', 'Audit_Project', 'Guideline']) {
      failNext(table)
      await expect(db.fetchUserProjects(U.head)).rejects.toBeTruthy()
    }
  })
})

describe('fetchProjectDetails', () => {
  it('fills in empty values for a member without a user row and a bare guideline', async () => {
    tables.Project_Member.push({ projectId: OTHER, userId: 'ghost' })
    tables.Guideline.push({ guidelineId: 'bare', projectId: OTHER })
    const details = await db.fetchProjectDetails(OTHER)
    expect(details.members).toEqual([{ userId: 'ghost', userName: '', role: '' }])
    expect(details.guidelines).toEqual([{ guidelineId: 'bare', guidelineName: '', shortName: '', version: '', description: '', source: '', categories: [], lastUpdated: '', originalGuidelineId: null }])
    expect(details.scope).toEqual([])
  })

  it('throws for an unknown project and when a read fails', async () => {
    await expect(db.fetchProjectDetails(id(999))).rejects.toMatchObject({ code: 'PGRST116' })
    for (const table of ['Project_Member', 'Guideline', 'Project_Scope']) {
      failNext(table)
      await expect(db.fetchProjectDetails(P)).rejects.toBeTruthy()
    }
  })
})

describe('createProject, updateProject, activateProject and deleteProject', () => {
  it('creates a draft with empty notes and due date, or the status given', async () => {
    const draft = await db.createProject({ title: 'T', platform: 'X (Twitter)', headAuditorId: U.head })
    expect(tables.Audit_Project.find((p) => p.projectId === draft)).toMatchObject({ projectStatus: 'draft', projectNotes: null, dueDate: null })
    const active = await db.createProject({ title: 'T2', platform: 'X', headAuditorId: U.head, status: 'in_progress' })
    expect(tables.Audit_Project.find((p) => p.projectId === active)?.projectStatus).toBe('in_progress')
    failNext('Audit_Project', 'insert')
    await expect(db.createProject({ title: 'T', platform: 'X', headAuditorId: U.head })).rejects.toBeTruthy()
  })

  it('updates only the fields given, and refuses a locked audit', async () => {
    await db.updateProject(P, { projectNotes: 'n' })
    expect(tables.Audit_Project.find((p) => p.projectId === P)).toMatchObject({ projectNotes: 'n', projectTitle: 'TikTok 2026' })
    await expect(db.updateProject(LOCKED, { projectNotes: 'n' })).rejects.toBeInstanceOf(db.EditLockedError)
    failNext('Audit_Project', 'update')
    await expect(db.updateProject(P, { projectNotes: 'm' })).rejects.toBeTruthy()
  })

  it('activates only a draft, and deletes a project', async () => {
    await db.activateProject(P)
    await db.activateProject(LOCKED)
    expect(tables.Audit_Project.find((p) => p.projectId === P)?.projectStatus).toBe('in_progress')
    expect(tables.Audit_Project.find((p) => p.projectId === LOCKED)?.projectStatus).toBe('under_review')
    failNext('Audit_Project', 'update')
    await expect(db.activateProject(P)).rejects.toBeTruthy()
    await db.deleteProject(OTHER)
    expect(tables.Audit_Project.map((p) => p.projectId)).not.toContain(OTHER)
  })
})

describe('members', () => {
  it('addProjectMember ignores a duplicate and throws other errors', async () => {
    await db.addProjectMember(P, U.aud)
    expect(members(P)).toEqual([U.aud, U.aud2])
    failNext('Project_Member', 'insert', { message: 'permission denied' })
    await expect(db.addProjectMember(P, U.outsider)).rejects.toMatchObject({ message: 'permission denied' })
  })

  it('removeProjectMember removes one member and throws on failure', async () => {
    await db.removeProjectMember(P, U.aud)
    expect(members(P)).toEqual([U.aud2])
    failNext('Project_Member', 'delete')
    await expect(db.removeProjectMember(P, U.aud2)).rejects.toBeTruthy()
  })

  it('syncProjectMembers adds and removes to match the list, and can empty it', async () => {
    await db.syncProjectMembers(P, [U.aud2, U.outsider])
    expect(members(P)).toEqual([U.aud2, U.outsider].sort())
    await db.syncProjectMembers(P, [])
    expect(members(P)).toEqual([])
  })

  it('syncProjectMembers refuses unknown users and locked audits', async () => {
    await expect(db.syncProjectMembers(P, [U.aud, 'nobody'])).rejects.toThrow('unknown user id(s): nobody')
    await expect(db.syncProjectMembers(LOCKED, [])).rejects.toBeInstanceOf(db.EditLockedError)
    expect(members(P)).toEqual([U.aud, U.aud2])
  })

  it('syncProjectMembers throws when a step fails', async () => {
    for (const [table, op] of [['User', 'select'], ['Project_Member', 'select'], ['Project_Member', 'delete'], ['Project_Member', 'insert']] as const) {
      failNext(table, op)
      await expect(db.syncProjectMembers(P, [U.outsider])).rejects.toBeTruthy()
    }
  })
})

describe('syncProjectScope', () => {
  it('adds and removes features, and throws when a step fails', async () => {
    tables.Project_Scope.push({ id: 's1', projectId: P, feature: 'Live' })
    await db.syncProjectScope(P, ['Chat'])
    expect(tables.Project_Scope.map((s) => s.feature)).toEqual(['Chat'])
    for (const op of ['select', 'delete', 'insert'] as const) {
      failNext('Project_Scope', op)
      await expect(db.syncProjectScope(P, op === 'insert' ? ['Chat', 'New'] : [])).rejects.toBeTruthy()
    }
  })
})

describe('fetchAllUsers and createUser', () => {
  it('stores the email trimmed and lower case', async () => {
    await db.createUser({ userId: 'u-new', userName: 'N', userEmail: ' N@X.TEST ', role: 'auditor', userPassword: 'p' })
    expect((await db.fetchAllUsers()).find((u) => u.userId === 'u-new')?.userEmail).toBe('n@x.test')
  })
})

describe('sendAssignmentEmail', () => {
  it('emails an auditor with the project and head auditor names, HTML-escaped', async () => {
    tables.Audit_Project.find((p) => p.projectId === P)!.projectTitle = 'Kids <b>&</b> "Teens"'
    await db.sendAssignmentEmail(P, U.outsider)
    expect(https.sent).toHaveLength(1)
    const { options, body } = https.sent[0]
    expect(options).toMatchObject({ hostname: 'api.brevo.com', port: 443, path: '/v3/smtp/email', method: 'POST' })
    expect(options.headers['api-key']).toBe('test-brevo-key')
    expect(options.headers['Content-Length']).toBe(Buffer.byteLength(body))
    const email = JSON.parse(body)
    expect(email.sender).toEqual({ name: 'SafetyAudit', email: 'audit@example.test' })
    expect(email.to).toEqual([{ email: 'out@example.test', name: 'Out Sider' }])
    expect(email.htmlContent).toContain('Kids &lt;b&gt;&amp;&lt;/b&gt; &quot;Teens&quot;')
    expect(email.htmlContent).not.toContain('<b>&</b>')
    expect(email.htmlContent).toContain('Hana Head')
  })

  it('says "Head Auditor" when the head auditor has no user row', async () => {
    tables.User = tables.User.filter((u) => u.userId !== U.head)
    await db.sendAssignmentEmail(P, U.outsider)
    expect(JSON.parse(https.sent[0].body).htmlContent).toContain('Head Auditor')
  })

  it('sends nothing to a head auditor, an admin, the project\'s own head auditor or an unknown user', async () => {
    await db.sendAssignmentEmail(P, U.headOther)
    await db.sendAssignmentEmail(P, U.admin)
    tables.User.find((u) => u.userId === U.head)!.role = 'auditor'
    await db.sendAssignmentEmail(P, U.head)
    await db.sendAssignmentEmail(P, 'nobody')
    await db.sendAssignmentEmail(id(999), U.aud)
    expect(https.sent).toHaveLength(0)
  })

  it('sends nothing when Brevo is not configured', async () => {
    delete process.env.BREVO_SENDER_EMAIL
    await db.sendAssignmentEmail(P, U.outsider)
    expect(https.sent).toHaveLength(0)
  })

  it('logs instead of throwing when Brevo refuses or the connection fails', async () => {
    https.status = 400
    await expect(db.sendAssignmentEmail(P, U.outsider)).resolves.toBeUndefined()
    expect(errors).toHaveBeenCalledWith('[Email] Brevo API returned status 400:', '{"ok":true}')
    https.fail = new Error('ECONNRESET')
    await expect(db.sendAssignmentEmail(P, U.outsider)).resolves.toBeUndefined()
    expect(errors).toHaveBeenCalledWith('[Email] Error sending email via Brevo:', https.fail)
  })

  it('logs instead of throwing when a lookup itself throws', async () => {
    tables.Audit_Project.find((p) => p.projectId === P)!.projectTitle = null
    await expect(db.sendAssignmentEmail(P, U.outsider)).resolves.toBeUndefined()
    expect(errors).toHaveBeenCalledWith('[Email] Failed to send assignment email:', expect.any(TypeError))
  })
})
