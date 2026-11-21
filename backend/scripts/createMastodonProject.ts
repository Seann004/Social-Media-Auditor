/**
 * Creates (or reuses) a project for trying the AI app audit on Mastodon, with six checks that Mastodon has an answer for,
 * owned by the given head auditor. The app address and test account are copied from an existing project that already
 * has them; the account's password is decrypted and encrypted again for the new project (it is never printed).
 *
 * Run from backend/:  npx tsx scripts/createMastodonProject.ts --owner head@gmail.com --from <projectIdWithTheAccount>
 * Then run the audit:  npx tsx scripts/runAppAudit.ts --project <the id printed here>
 *
 * Remove later: delete the project in the app, and the guideline "Auto-audit test (Mastodon)" in the Admin screen.
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import { getSupabaseAdmin } from '../src/config/supabaseAdmin.js'
import { decryptSecret, encryptSecret, parseSecretKey, secretAad } from '../src/features/evidence/secrets.js'
import { createSupabaseAppRepository } from '../src/features/evidence/supabaseAppRepository.js'
import * as db from '../src/services/dbService.js'

const GUIDELINE_NAME = 'Auto-audit test (Mastodon)'
const PROJECT_TITLE = 'Auto-audit test: Mastodon'

/** The checks, with the answer expected from what Mastodon's settings offer (to be confirmed by a person in the browser). */
const ITEMS = [
  { code: 'M-1', category: 'Privacy', text: 'Can an account be set so that people must request to follow it?', expected: 'yes' },
  { code: 'M-2', category: 'Privacy', text: 'Can a user choose who can see their posts by default?', expected: 'yes' },
  { code: 'M-3', category: 'Privacy', text: 'Can a user hide the list of who they follow and who follows them?', expected: 'yes' },
  { code: 'M-4', category: 'Contact', text: 'Can a user block or mute other people?', expected: 'yes' },
  { code: 'M-5', category: 'Wellbeing', text: 'Does the app have a built-in screen-time limit or daily usage timer?', expected: 'no' },
  { code: 'M-6', category: 'Parental', text: "Does the app have a parent account that can manage a teen account's settings?", expected: 'no' },
] as const

const args = process.argv.slice(2)
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? (args[at + 1] ?? '') : null
}

async function ensureGuideline(adminId: string): Promise<string> {
  const found = (await db.fetchGuidelines()).find((g) => g.guidelineName === GUIDELINE_NAME)
  if (found) return found.guidelineId
  const guidelineId = crypto.randomUUID()
  await db.createGuideline({
    guideline: {
      guidelineId,
      guidelineName: GUIDELINE_NAME,
      shortName: 'AUTOMAST',
      version: '1.0',
      description: 'Six checks that Mastodon has an answer for, for trying the AI app audit on a real app.',
      source: 'Test data',
      categories: [...new Set(ITEMS.map((i) => i.category))],
      lastUpdated: new Date().toISOString().slice(0, 10),
      userId: adminId,
    },
    items: ITEMS.map((i) => ({ id: crypto.randomUUID(), category: i.category, severity: 'major' as const, itemCode: i.code, text: i.text })),
  })
  console.log(`Guideline created: ${GUIDELINE_NAME}`)
  return guidelineId
}

async function main(): Promise<void> {
  const owner = flag('owner')
  const from = flag('from')
  if (!owner || !from) throw new Error('Give --owner <head auditor email> and --from <project id that has the app and account>.')
  const secretKey = parseSecretKey(process.env.EVIDENCE_SECRET_KEY)
  if (!secretKey) throw new Error('EVIDENCE_SECRET_KEY is not set.')
  const admin = getSupabaseAdmin()
  if (!admin) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')
  const appRepo = createSupabaseAppRepository(admin)

  const users = await db.fetchAllUsers()
  const head = users.find((u) => u.userEmail.toLowerCase() === owner.toLowerCase())
  const adminUser = users.find((u) => u.role === 'admin')
  if (!head || head.role !== 'head_auditor') throw new Error(`${owner} is not a head auditor account.`)
  if (!adminUser) throw new Error('No admin account found to own the guideline.')

  const source = await appRepo.getAppSource(from)
  const accounts = await appRepo.listTestAccounts(from)
  if (!source || accounts.length === 0) throw new Error('The source project has no app address or no test account.')

  const guidelineId = await ensureGuideline(adminUser.userId)
  const existing = (await db.fetchUserProjects(head.userId)).find((p) => p.projectTitle === PROJECT_TITLE)
  const projectId =
    existing?.projectId ??
    (await db.createProject({
      title: PROJECT_TITLE,
      platform: 'Social',
      headAuditorId: head.userId,
      notes: 'Created by scripts/createMastodonProject.ts to try the AI app audit on a real app (Mastodon).',
      dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      status: 'in_progress',
    }))
  console.log(existing ? `Project exists, reused: ${PROJECT_TITLE}` : `Project created: ${PROJECT_TITLE}`)
  if ((await db.fetchProjectChecklistItems(projectId)).length === 0) {
    await db.syncProjectGuidelines(projectId, [guidelineId])
    await db.initializeProjectChecklists(projectId)
  }

  await appRepo.saveAppSource(projectId, { appUrl: source.appUrl, loginDomains: source.loginDomains }, head.userId)
  const have = await appRepo.listTestAccounts(projectId)
  for (const a of accounts) {
    if (have.some((x) => x.label === a.label)) continue
    const id = crypto.randomUUID()
    const password = decryptSecret(a.passwordCiphertext, secretKey, secretAad(from, a.id))
    await appRepo.addTestAccount({
      id,
      projectId,
      label: a.label,
      ageGroup: a.ageGroup,
      age: a.age,
      loginName: a.loginName,
      handles: a.handles,
      passwordCiphertext: encryptSecret(password, secretKey, secretAad(projectId, id)),
      createdBy: head.userId,
    })
    console.log(`Test account copied: ${a.label} (${a.ageGroup})`)
  }

  console.log(`App: ${source.appUrl}`)
  console.log('Expected answers (from what Mastodon offers; confirm in the browser):')
  for (const i of ITEMS) console.log(`  ${i.code} ${i.expected.padEnd(3)} ${i.text}`)
  console.log(`\nProject id: ${projectId}\nNext: npx tsx scripts/runAppAudit.ts --project ${projectId}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
