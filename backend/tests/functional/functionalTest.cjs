// Run from backend/ with the server running on FT_API (default http://127.0.0.1:3917):
//   PORT=3917 npx tsx src/server.ts   then   npm run test:functional [-- <results.json>]
// Results go to docs/testing/<today>-functional-results.json unless a path is given.
// Not part of `npm test`: it writes to the real database, so it only runs when asked for.
// Functional test pass over the core API, against a locally started backend and the real Supabase database.
// Creates one scratch project, then deletes it and checks that every table is back to its earlier row count.
const path = require('path').resolve(__dirname, '..', '..') + '/'
const req = require('module').createRequire(path + 'package.json')
req('dotenv').config({ path: path + '.env' })
const crypto = require('crypto')
const fs = require('fs')
const { createClient } = req('@supabase/supabase-js')

const API = process.env.FT_API || 'http://127.0.0.1:3917'
const OUT = process.argv[2] || require('path').resolve(path, '..', 'docs', 'testing', `${new Date().toISOString().slice(0, 10)}-functional-results.json`)
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const TABLES = ['Audit_Project', 'Audit_Report', 'Audit_Result', 'Checklist', 'Checklist_Item', 'Checklist_Resolution', 'Guideline', 'Project_Member', 'Project_Scope', 'User', 'Item_Mapping']
const ACCOUNTS = {
  admin: ['admin@demo.safetyaudit.test', 'Admin#2026'],
  head: ['head@demo.safetyaudit.test', 'Head#2026'],
  auditor: ['auditor@demo.safetyaudit.test', 'Auditor#2026'],
}
const hash = (p) => crypto.createHash('sha256').update(p, 'utf8').digest('hex')
const results = []

async function call(method, url, token, body) {
  const started = Date.now()
  const send = () => fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let res
  try { res = await send() } catch (e) {
    // A network blip (not an HTTP error): wait and try once more, so one dropped connection cannot stop a run halfway.
    console.error(`network error on ${method} ${url} (${e.message}), retrying once`)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    res = await send()
  }
  let json = null
  try { json = await res.json() } catch { /* empty body */ }
  return { status: res.status, json, ms: Date.now() - started }
}

function record(id, requirement, test, expected, actual, pass) {
  results.push({ id, requirement, test, expected, actual, pass: Boolean(pass) })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${test} -> ${actual}`)
}

async function counts() {
  const out = {}
  for (const t of TABLES) {
    const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true })
    if (error) throw new Error(`count ${t}: ${error.message}`)
    out[t] = count
  }
  return out
}

async function main() {
  const before = await counts()
  const tok = {}
  const ids = {}

  // FR1 authentication and roles
  for (const [role, [email, pw]] of Object.entries(ACCOUNTS)) {
    const r = await call('POST', '/api/auth/login', null, { email, password: hash(pw) })
    tok[role] = r.json?.token
    ids[role] = r.json?.user?.userId
    const want = { admin: 'admin', head: 'head_auditor', auditor: 'auditor' }[role]
    record(`FT-01${'abc'[Object.keys(ACCOUNTS).indexOf(role)]}`, 'Login', `Log in as ${want} with valid credentials`, `200, token, role ${want}`, `${r.status}, role ${r.json?.user?.role}`, r.status === 200 && r.json?.token && r.json?.user?.role === want)
  }
  let r = await call('POST', '/api/auth/login', null, { email: ACCOUNTS.auditor[0], password: hash('Wrong#2026') })
  record('FT-02', 'Login', 'Log in with a wrong password', '401, no token', `${r.status}, token ${r.json?.token ? 'given' : 'none'}`, r.status === 401 && !r.json?.token)
  r = await call('POST', '/api/auth/login', null, { email: ACCOUNTS.auditor[0] })
  record('FT-03', 'Login', 'Log in with the password missing', '400', `${r.status}`, r.status === 400)
  r = await call('GET', '/api/projects', null)
  record('FT-04', 'Login', 'Open the project list without logging in', '401', `${r.status}`, r.status === 401)

  // FR2 project management
  r = await call('POST', '/api/projects', tok.head, { title: '[FT] scratch project', platform: 'TikTok', notes: 'functional test, deleted at the end' })
  const projectId = r.json?.projectId
  record('FT-05', 'Project management', 'Head auditor creates an audit project', '201 with a project id', `${r.status}${projectId ? ', id returned' : ''}`, r.status === 201 && projectId)
  if (!projectId) throw new Error('no project, cannot continue')
  r = await call('POST', '/api/projects', tok.auditor, { title: '[FT] should fail', platform: 'TikTok' })
  record('FT-06', 'Project management', 'Auditor tries to create a project', '403', `${r.status}`, r.status === 403)
  r = await call('POST', '/api/projects', tok.head, { title: '' })
  record('FT-07', 'Project management', 'Create a project with no title or platform', '400', `${r.status}`, r.status === 400)

  // FR3 guideline attachment and checklist
  const g = await call('GET', '/api/guidelines', tok.head)
  const guideline = (g.json || []).find((x) => x.guidelineName === 'Overlap Test A (Code)' && !x.projectId) || (g.json || []).find((x) => x.guidelineName === 'Overlap Test A (Code)')
  r = await call('POST', `/api/projects/${projectId}/guidelines`, tok.head, { guidelineIds: [guideline.guidelineId] })
  const cl = await call('GET', `/api/projects/${projectId}/checklist`, tok.head)
  const items = Array.isArray(cl.json) ? cl.json : []
  record('FT-08', 'Checklist', 'Head auditor attaches a guideline to the project', '200; the checklist lists the guideline items', `${r.status}; ${items.length} items`, r.status === 200 && items.length > 0)

  // FR4 team and access
  r = await call('GET', `/api/projects/${projectId}`, tok.auditor)
  record('FT-09', 'Access control', 'Auditor opens a project they are not assigned to', '403', `${r.status}`, r.status === 403)
  r = await call('POST', `/api/projects/${projectId}/members/add`, tok.head, { userId: ids.auditor })
  const mine = await call('GET', '/api/projects', tok.auditor)
  const listed = (mine.json || []).some((p) => p.projectId === projectId)
  record('FT-10', 'Project management', 'Head auditor assigns the auditor to the project', '200; the project appears in the auditor list', `${r.status}; ${listed ? 'listed' : 'not listed'}`, r.status === 200 && listed)

  // FR3b editing the checklist (before submission locks it)
  const newItem = { category: 'Privacy', text: '[FT] Teen accounts hide their follower list by default.', severity: 'minor', guidelineId: items[0].guidelineId }
  r = await call('POST', `/api/projects/${projectId}/checklist/items`, tok.head, newItem)
  const addedItemId = r.json?.itemId
  let checklistNow = await call('GET', `/api/projects/${projectId}/checklist`, tok.head)
  const added = (checklistNow.json || []).find((x) => x.itemId === addedItemId)
  record('FT-25', 'Checklist', 'Head auditor adds a checklist item to the project', '201; item appears in the checklist', `${r.status}; ${added ? 'listed' : 'not listed'}`, r.status === 201 && added)
  r = await call('PATCH', `/api/checklist/items/${addedItemId}`, tok.head, { severity: 'critical' })
  checklistNow = await call('GET', `/api/projects/${projectId}/checklist`, tok.head)
  const sev = (checklistNow.json || []).find((x) => x.itemId === addedItemId)?.severity
  record('FT-26', 'Checklist', 'Head auditor changes the item severity to critical', '200; severity is critical', `${r.status}; ${sev}`, r.status === 200 && sev === 'critical')
  r = await call('PATCH', `/api/checklist/items/${addedItemId}`, tok.head, { severity: 'extreme' })
  record('FT-27', 'Checklist', 'Change the severity to a value that does not exist', '400', `${r.status}`, r.status === 400)
  r = await call('POST', `/api/projects/${projectId}/checklist/items`, tok.auditor, newItem)
  record('FT-28', 'Checklist', 'Auditor tries to add a checklist item', '403', `${r.status}`, r.status === 403)
  r = await call('DELETE', `/api/checklist/items/${addedItemId}`, tok.head)
  checklistNow = await call('GET', `/api/projects/${projectId}/checklist`, tok.head)
  const stillThere = (checklistNow.json || []).some((x) => x.itemId === addedItemId)
  record('FT-29', 'Checklist', 'Head auditor deletes the added item', '200; item gone from the checklist', `${r.status}; ${stillThere ? 'still listed' : 'gone'}`, r.status === 200 && !stillThere)

  // FR8b creating a report by hand
  r = await call('POST', '/api/reports', tok.auditor, { projectId })
  record('FT-30', 'Reports', 'Project member creates a report for the project', '201 with a report id', `${r.status}${r.json?.reportId ? ', id returned' : ''}`, r.status === 201 && r.json?.reportId)
  r = await call('POST', '/api/reports', tok.admin, { projectId })
  record('FT-31', 'Reports', 'Someone outside the project tries to create its report', '403', `${r.status}`, r.status === 403)

  // FR5 conducting the audit
  const item0 = items[0]
  const gid = item0.guidelineId
  r = await call('POST', `/api/projects/${projectId}/results`, tok.auditor, { itemId: item0.itemId, guidelineId: gid, result: 'maybe' })
  record('FT-11', 'Conduct audit', 'Save an answer with an invalid status', '400', `${r.status}`, r.status === 400)
  r = await call('POST', `/api/projects/${projectId}/submit`, tok.auditor)
  record('FT-12', 'Submission', 'Submit while items are unanswered', '409, not submitted', `${r.status}`, r.status === 409)
  const answers = ['compliant', 'non_compliant', 'partially', 'compliant', 'not_applicable', 'compliant', 'compliant', 'non_compliant']
  let saved = 0
  for (let i = 0; i < items.length; i++) {
    const a = await call('POST', `/api/projects/${projectId}/results`, tok.auditor, { itemId: items[i].itemId, guidelineId: items[i].guidelineId, result: answers[i % answers.length], notes: '' })
    if (a.status === 200) saved++
  }
  const res = await call('GET', `/api/projects/${projectId}/results`, tok.auditor)
  const stored = (res.json || []).filter((x) => x.projectId === projectId || x.itemId).length
  record('FT-13', 'Conduct audit', `Auditor answers all ${items.length} checklist items`, `${items.length} answers saved and returned`, `${saved} saved; ${stored} returned`, saved === items.length && stored >= items.length)
  r = await call('PATCH', `/api/projects/${projectId}/results/${item0.itemId}/findings`, tok.auditor, { findings: 'Teen accounts were public by default in the test.' })
  record('FT-14', 'Conduct audit', 'Auditor records a written finding for an item', '200', `${r.status}`, r.status === 200)
  r = await call('PATCH', `/api/projects/${projectId}/results/${item0.itemId}/evidence`, tok.auditor, { images: [{ url: 'https://example.test/shot.png', name: 'shot.png' }] })
  record('FT-15', 'Conduct audit', 'Auditor attaches an evidence image to an item', '200', `${r.status}`, r.status === 200)

  // FR6 compliance score
  r = await call('GET', `/api/projects/${projectId}/compliance-scores`, tok.head)
  record('FT-16', 'Compliance score', 'Compliance score is computed from the answers', '200 with a score per guideline', `${r.status}; ${JSON.stringify(r.json).slice(0, 160)}`, r.status === 200 && Array.isArray(r.json) && r.json.length > 0)
  const scoreSample = r.json

  // FR7 submission and review
  r = await call('POST', `/api/projects/${projectId}/submit`, tok.auditor)
  let p = await call('GET', `/api/projects/${projectId}`, tok.head)
  const sub1 = p.json?.submissionStatus ?? p.json?.project?.submissionStatus
  record('FT-17', 'Submission', 'Auditor submits the completed audit for review', '200; status pending_review', `${r.status}; ${sub1}`, r.status === 200 && sub1 === 'pending_review')
  r = await call('POST', `/api/projects/${projectId}/results`, tok.auditor, { itemId: item0.itemId, guidelineId: gid, result: 'compliant' })
  record('FT-18', 'Submission', 'Auditor edits an answer after submitting', '403 (audit locked)', `${r.status}`, r.status === 403)
  r = await call('POST', `/api/projects/${projectId}/review`, tok.auditor, { approved: true })
  record('FT-19', 'Review', 'Auditor tries to approve their own submission', '403', `${r.status}`, r.status === 403)
  r = await call('POST', `/api/projects/${projectId}/review`, tok.head, { approved: true, remarks: 'Functional test approval' })
  p = await call('GET', `/api/projects/${projectId}`, tok.head)
  const sub2 = p.json?.submissionStatus ?? p.json?.project?.submissionStatus
  record('FT-20', 'Review', 'Head auditor approves the submission', '200; status approved', `${r.status}; ${sub2}`, r.status === 200 && sub2 === 'approved')

  // FR8 reports
  r = await call('GET', '/api/reports', tok.head)
  const inReports = (r.json || []).some((x) => x.projectId === projectId || x.project?.projectId === projectId)
  record('FT-21', 'Reports', 'The approved audit appears in the head auditor reports', '200; project listed', `${r.status}; ${inReports ? 'listed' : 'not listed'}`, r.status === 200 && inReports)

  // FR9 AI guideline generator
  const clause = 'Section 4.1 Default settings for children. Online services likely to be accessed by children under 18 must set the highest privacy settings by default. Section 4.2 Location. Geolocation options must be switched off by default for child users, and an obvious sign must be shown when location tracking is active.'
  r = await call('POST', '/api/generator/process-chunk', tok.admin, { textChunk: clause, platform: 'TikTok' })
  const genItems = r.json?.items ?? r.json?.checklistItems ?? (Array.isArray(r.json) ? r.json : null)
  record('FT-22', 'Guideline generator', 'Admin extracts checklist items from a regulation text with the AI', '200 with checklist items', `${r.status}; ${Array.isArray(genItems) ? genItems.length + ' items' : JSON.stringify(r.json).slice(0, 120)}`, r.status === 200 && Array.isArray(genItems) && genItems.length > 0)
  const genSample = Array.isArray(genItems) ? genItems.slice(0, 3) : r.json
  r = await call('POST', '/api/generator/process-chunk', tok.auditor, { textChunk: clause })
  record('FT-23', 'Guideline generator', 'Auditor tries to use the generator', '403', `${r.status}`, r.status === 403)

  // FR10 self-registration
  const newUserId = crypto.randomUUID()
  const newEmail = `ft-register-${newUserId.slice(0, 8)}@example.test`
  r = await call('POST', '/api/users', null, { userId: newUserId, userName: '[FT] New Auditor', userEmail: newEmail, role: 'auditor', userPassword: hash('Register#2026') })
  const loginNew = await call('POST', '/api/auth/login', null, { email: newEmail, password: hash('Register#2026') })
  record('FT-32', 'Registration', 'A new user registers as an auditor and logs in', '201; then login 200 with role auditor', `${r.status}; login ${loginNew.status}, role ${loginNew.json?.user?.role}`, r.status === 201 && loginNew.status === 200 && loginNew.json?.user?.role === 'auditor')
  r = await call('POST', '/api/users', null, { userId: crypto.randomUUID(), userName: '[FT] Wants Admin', userEmail: `ft-admin-${Date.now()}@example.test`, role: 'admin', userPassword: hash('Register#2026') })
  record('FT-33', 'Registration', 'Someone registers themselves as an admin', '403', `${r.status}`, r.status === 403)
  r = await call('POST', '/api/users', null, { userId: 'not-a-uuid', userName: '[FT] Bad', userEmail: `ft-bad-${Date.now()}@example.test`, role: 'auditor', userPassword: hash('Register#2026') })
  record('FT-34', 'Registration', 'Register with an invalid user id', '400', `${r.status}`, r.status === 400)
  const { error: delUserError } = await sb.from('User').delete().eq('userId', newUserId)
  if (delUserError) console.error('could not remove the registered test user:', delUserError.message)

  // FR11 guideline upload and deletion (admin)
  const newGuidelineId = crypto.randomUUID()
  const guidelineBody = {
    guideline: { guidelineId: newGuidelineId, guidelineName: '[FT] Scratch guideline', shortName: 'FTG', version: '1.0', description: 'Functional test, deleted at the end', source: 'Functional test', categories: ['Privacy'], lastUpdated: new Date().toISOString().slice(0, 10), userId: ids.admin },
    items: [{ id: crypto.randomUUID(), category: 'Privacy', text: '[FT] Location sharing is off by default for child accounts.', severity: 'major', itemCode: 'FTG-1' }],
  }
  r = await call('POST', '/api/guidelines', tok.admin, guidelineBody)
  const listedG = await call('GET', '/api/guidelines', tok.admin)
  const gFound = (listedG.json || []).some((x) => x.guidelineId === newGuidelineId)
  const gItems = await call('GET', `/api/guidelines/${newGuidelineId}/items`, tok.admin)
  record('FT-35', 'Guideline management', 'Admin uploads a guideline with one item', '201; guideline listed with its item', `${r.status}; ${gFound ? 'listed' : 'not listed'}, ${Array.isArray(gItems.json) ? gItems.json.length : '?'} item(s)`, r.status === 201 && gFound && Array.isArray(gItems.json) && gItems.json.length === 1)
  r = await call('POST', '/api/guidelines', tok.head, { ...guidelineBody, guideline: { ...guidelineBody.guideline, guidelineId: crypto.randomUUID() } })
  record('FT-36', 'Guideline management', 'Head auditor tries to upload a guideline', '403', `${r.status}`, r.status === 403)
  // Uploading starts similar-item matching in the background; give it a moment so the delete does not race it.
  await new Promise((resolve) => setTimeout(resolve, 5000))
  r = await call('DELETE', `/api/guidelines/${newGuidelineId}`, tok.admin)
  const listedAfter = await call('GET', '/api/guidelines', tok.admin)
  const gGone = !(listedAfter.json || []).some((x) => x.guidelineId === newGuidelineId)
  record('FT-37', 'Guideline management', 'Admin deletes the uploaded guideline', '200; guideline no longer listed', `${r.status}; ${gGone ? 'gone' : 'still listed'}`, r.status === 200 && gGone)

  // Clean up
  r = await call('DELETE', `/api/projects/${projectId}`, tok.head)
  const gone = await call('GET', `/api/projects/${projectId}`, tok.head)
  record('FT-24', 'Project management', 'Head auditor deletes the project', '200; project no longer reachable', `${r.status}; then ${gone.status}`, r.status === 200 && gone.status !== 200)

  // Leftovers the delete does not cascade to (cloned guideline rows): remove them, and report it.
  const { data: leftG } = await sb.from('Guideline').select('guidelineId').eq('projectId', projectId)
  const after = await counts()
  const diff = Object.fromEntries(TABLES.filter((t) => after[t] !== before[t]).map((t) => [t, `${before[t]} -> ${after[t]}`]))
  fs.writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), results, scoreSample, genSample, before, after, diff, leftoverGuidelines: leftG }, null, 2))
  console.log('table differences after delete:', diff, 'leftover guideline clones:', leftG?.length)
}

main().catch((e) => { console.error('stopped:', e.message); fs.writeFileSync(OUT, JSON.stringify({ error: e.message, results }, null, 2)); process.exit(1) })
