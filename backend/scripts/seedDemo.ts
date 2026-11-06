/**
 * Creates three demo accounts (Admin, Head Auditor, Auditor) and one demo audit project,
 * using the app's own database service so the rows match what the app writes.
 *
 * Run from backend/ once Supabase is reachable:  npx tsx scripts/seedDemo.ts
 * Safe to run twice: existing accounts and the existing demo project are reused, not duplicated.
 */
import crypto from 'crypto'
import * as db from '../src/services/dbService.js'
import type { UserRole } from '../src/types/index.js'

interface DemoAccount {
  role: UserRole
  name: string
  email: string
  password: string
}

/** Demo-only passwords. They meet the sign-up rules (8+ chars, upper case, number, symbol). */
const ACCOUNTS: readonly DemoAccount[] = [
  { role: 'admin', name: 'Demo Admin', email: 'admin@demo.safetyaudit.test', password: 'Admin#2026' },
  { role: 'head_auditor', name: 'Demo Head Auditor', email: 'head@demo.safetyaudit.test', password: 'Head#2026' },
  { role: 'auditor', name: 'Demo Auditor', email: 'auditor@demo.safetyaudit.test', password: 'Auditor#2026' },
]

const PROJECT_TITLE = 'Demo: TikTok child-safety audit'
const DEMO_GUIDELINE_NAME = 'Demo Child Safety Checklist'
const DEMO_START_URLS = ['https://www.tiktok.com/safety/en/', 'https://www.tiktok.com/legal/page/global/privacy-policy-for-younger-users/en']

/** Same hashing the browser does before calling verify_user_login (frontend/src/lib/crypto.ts). */
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex')
}

async function ensureUsers(): Promise<Map<UserRole, string>> {
  const existing = await db.fetchAllUsers()
  const ids = new Map<UserRole, string>()
  for (const account of ACCOUNTS) {
    const found = existing.find((u) => u.userEmail.toLowerCase() === account.email)
    if (found) {
      console.log(`Account exists, reused: ${account.email}`)
      ids.set(account.role, found.userId)
      continue
    }
    const userId = crypto.randomUUID()
    await db.createUser({
      userId,
      userName: account.name,
      userEmail: account.email,
      role: account.role,
      userPassword: hashPassword(account.password),
    })
    console.log(`Account created: ${account.email}`)
    ids.set(account.role, userId)
  }
  return ids
}

async function ensureGuideline(adminId: string): Promise<string> {
  // Always the demo checklist, never someone else's guideline, so the demo has known items.
  const guidelines = await db.fetchGuidelines()
  const demo = guidelines.find((g) => g.guidelineName === DEMO_GUIDELINE_NAME)
  if (demo) {
    console.log(`Using the demo guideline: ${DEMO_GUIDELINE_NAME}`)
    return demo.guidelineId
  }
  const guidelineId = crypto.randomUUID()
  await db.createGuideline({
    guideline: {
      guidelineId,
      guidelineName: DEMO_GUIDELINE_NAME,
      shortName: 'DEMO',
      version: '1.0',
      description: 'A small checklist for demonstrating SafetyAudit.',
      source: 'Demo data',
      categories: ['Privacy by default', 'Reporting and safety tools'],
      lastUpdated: new Date().toISOString().slice(0, 10),
      userId: adminId,
    },
    items: [
      { id: crypto.randomUUID(), category: 'Privacy by default', severity: 'critical', itemCode: 'P-1',
        text: 'Accounts of users under 16 are private by default.' },
      { id: crypto.randomUUID(), category: 'Privacy by default', severity: 'major', itemCode: 'P-2',
        text: 'Direct messages are off by default for users under 16.' },
      { id: crypto.randomUUID(), category: 'Privacy by default', severity: 'major', itemCode: 'P-3',
        text: 'The privacy policy for younger users is easy to find.' },
      { id: crypto.randomUUID(), category: 'Reporting and safety tools', severity: 'critical', itemCode: 'R-1',
        text: 'Users can report a video, comment or account from the app.' },
      { id: crypto.randomUUID(), category: 'Reporting and safety tools', severity: 'major', itemCode: 'R-2',
        text: 'Parents can link to a teen account to manage safety settings.' },
      { id: crypto.randomUUID(), category: 'Reporting and safety tools', severity: 'minor', itemCode: 'R-3',
        text: 'A safety centre explains the tools available to teens and parents.' },
    ],
  })
  console.log(`Guideline created: ${DEMO_GUIDELINE_NAME}`)
  return guidelineId
}

async function ensureProject(headId: string, auditorId: string, guidelineId: string): Promise<string> {
  const projects = await db.fetchUserProjects(headId)
  const found = projects.find((p) => p.projectTitle === PROJECT_TITLE)
  let projectId: string
  if (found) {
    projectId = found.projectId
    console.log(`Demo project exists, reused: ${PROJECT_TITLE}`)
  } else {
    const dueDate = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    projectId = await db.createProject({
      title: PROJECT_TITLE,
      platform: 'TikTok',
      headAuditorId: headId,
      notes: 'Demo project for trying the AI evidence assessment.',
      dueDate,
      status: 'in_progress',
    })
    await db.addProjectMember(projectId, auditorId)
    console.log(`Demo project created: ${PROJECT_TITLE}`)
  }

  // Give the project the demo checklist if it has no items yet (also repairs an earlier run).
  if ((await db.fetchProjectChecklistItems(projectId)).length > 0) return projectId
  await db.syncProjectGuidelines(projectId, [guidelineId])
  await db.initializeProjectChecklists(projectId)

  // Two answered items, so the page and reports show progress and a manual answer.
  const items = await db.fetchProjectChecklistItems(projectId)
  console.log(`Demo checklist attached: ${items.length} items`)
  const [first, second] = items
  if (first) {
    await db.upsertAuditResult(projectId, first.itemId, auditorId, first.guidelineId, 'compliant')
    await db.saveAuditFindings(projectId, first.itemId, auditorId, 'Checked the account settings page: private by default for teen accounts.')
  }
  if (second) {
    await db.upsertAuditResult(projectId, second.itemId, auditorId, second.guidelineId, 'partially')
  }
  return projectId
}

/** Saves the demo start links for the AI panel. Needs SUPABASE_SERVICE_ROLE_KEY; skipped without it. */
async function ensureEvidenceSource(projectId: string, auditorId: string): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('SUPABASE_SERVICE_ROLE_KEY not set: skipped saving demo links for the AI panel.')
    return
  }
  const { getSupabaseAdmin } = await import('../src/config/supabaseAdmin.js')
  const { createSupabaseRepository } = await import('../src/features/evidence/supabaseRepository.js')
  const admin = getSupabaseAdmin()
  if (!admin) return
  const repo = createSupabaseRepository(admin)
  if (await repo.getSource(projectId)) return
  await repo.saveSource(projectId, DEMO_START_URLS, auditorId)
  console.log('Demo links saved for the AI evidence panel.')
}

async function main(): Promise<void> {
  const ids = await ensureUsers()
  const adminId = ids.get('admin')!
  const headId = ids.get('head_auditor')!
  const auditorId = ids.get('auditor')!
  const guidelineId = await ensureGuideline(adminId)
  const projectId = await ensureProject(headId, auditorId, guidelineId)
  await ensureEvidenceSource(projectId, auditorId)
  console.log('\nDemo ready. Sign in with:')
  for (const a of ACCOUNTS) console.log(`  ${a.role.padEnd(13)} ${a.email}  /  ${a.password}`)
}

main().catch((error) => {
  console.error('Seeding failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
