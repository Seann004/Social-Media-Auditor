/**
 * Runs the AI app audit against the practice social app and leaves everything in the database, so the result
 * can be opened in the browser (the project appears in the head auditor's list).
 *
 * It creates (or reuses): a guideline with six items, a project owned by the given head auditor, the practice app
 * address and its two test accounts. Then it starts the practice app on a fixed port and runs the real audit with the
 * real AI and browser, through the same run code the server uses.
 *
 * Run from backend/:  npx tsx scripts/autoAuditDemo.ts --owner head@gmail.com [--keep]
 *   --keep    leave the practice app running afterwards (Ctrl+C to stop it)
 *   --only T-3,T-5   run only these items (default: all six)
 *   --key-env NAME   the environment variable holding the Groq key (default GROQ_API_KEY2, then GROQ_API_KEY)
 *
 * Remove later: delete the project in the app, and the guideline "Auto-audit test (practice app)" in the Admin screen.
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import { getSupabaseAdmin } from '../src/config/supabaseAdmin.js'
import { createAuditData } from '../src/features/evidence/auditData.js'
import { verifyClaim } from '../src/features/evidence/claimCheck.js'
import { APP_PROMPT_VERSION } from '../src/features/evidence/config.js'
import { runEvidenceJob } from '../src/features/evidence/runner.js'
import { encryptSecret, parseSecretKey, secretAad } from '../src/features/evidence/secrets.js'
import { createSupabaseAppRepository } from '../src/features/evidence/supabaseAppRepository.js'
import { createSupabaseRepository, createSupabaseScreenshotStore } from '../src/features/evidence/supabaseRepository.js'
import { createUrlGuard } from '../src/features/evidence/urlGuard.js'
import * as db from '../src/services/dbService.js'
import { LOGIN_NAMES, PASSWORDS, startSocialApp } from '../tests/fixtures/socialApp.js'

const UNSEEN = process.argv.includes('--set') && process.argv[process.argv.indexOf('--set') + 1] === 'unseen'
const GUIDELINE_NAME = UNSEEN ? 'Auto-audit test (practice app, unseen items)' : 'Auto-audit test (practice app)'
const PROJECT_TITLE = UNSEEN ? 'Auto-audit test: practice app, unseen items' : 'Auto-audit test: practice app'
const PORT = 4600
const MODEL = process.env.EVIDENCE_GROQ_MODEL || 'openai/gpt-oss-120b'

/** The six items, and the right answer for each in the practice app's starting state below. */
const TUNED_ITEMS = [
  { code: 'T-1', category: 'Privacy', text: 'Is the Teen 15 account currently private?', expected: 'yes' },
  { code: 'T-2', category: 'Notifications', text: 'Are push notifications switched off for the Teen 15 account?', expected: 'no' },
  { code: 'T-3', category: 'Contact', text: 'Can other people tag the Teen 15 account?', expected: 'no' },
  { code: 'T-4', category: 'Contact', text: 'Can a teen hide their birthday from everyone?', expected: 'yes' },
  { code: 'T-5', category: 'Privacy', text: 'Is quiet mode turned on for the Teen 15 account?', expected: 'yes' },
  { code: 'T-6', category: 'Privacy', text: 'Does the Teen 15 account show its activity status to other people?', expected: 'no' },
] as const
/** Items written after the fixes, with new wording and the Adult account too, so the results are not tuned to them. Start state: posts public, email and push on, quiet mode off and activity status shown for the Adult. */
const UNSEEN_ITEMS = [
  { code: 'U-1', category: 'Privacy', text: "Are the Teen 15 account's new posts visible to everyone by default?", expected: 'yes' },
  { code: 'U-2', category: 'Notifications', text: 'Is email notification enabled for the Teen 15 account?', expected: 'yes' },
  { code: 'U-3', category: 'Security', text: 'Can the Teen 15 account change its own password from the settings?', expected: 'yes' },
  { code: 'U-4', category: 'Privacy', text: "Is the Adult 30 account's activity status shown to other people?", expected: 'yes' },
  { code: 'U-5', category: 'Privacy', text: 'Is quiet mode switched off for the Adult 30 account?', expected: 'yes' },
  { code: 'U-6', category: 'Security', text: 'Does the Teen 15 account have an option to delete the account?', expected: 'yes' },
] as const
const ITEMS = UNSEEN ? UNSEEN_ITEMS : TUNED_ITEMS

const args = process.argv.slice(2)
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? (args[at + 1] ?? '') : null
}
const OWNER = flag('owner')
const KEEP = args.includes('--keep')
const keyEnv = flag('key-env')

function groqKey(): string {
  const names = keyEnv ? [keyEnv] : ['GROQ_API_KEY2', 'GROQ_API_KEY']
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  throw new Error(`No Groq key found in ${names.join(' or ')}.`)
}

async function ensureGuideline(adminId: string): Promise<string> {
  const found = (await db.fetchGuidelines()).find((g) => g.guidelineName === GUIDELINE_NAME)
  if (found) return found.guidelineId
  const guidelineId = crypto.randomUUID()
  await db.createGuideline({
    guideline: {
      guidelineId,
      guidelineName: GUIDELINE_NAME,
      shortName: 'AUTOAPP',
      version: '1.0',
      description: 'Six items for trying the AI app audit against the practice app.',
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

async function ensureProject(headId: string, guidelineId: string): Promise<string> {
  const found = (await db.fetchUserProjects(headId)).find((p) => p.projectTitle === PROJECT_TITLE)
  let projectId: string
  if (found) {
    projectId = found.projectId
    console.log(`Project exists, reused: ${PROJECT_TITLE}`)
  } else {
    projectId = await db.createProject({
      title: PROJECT_TITLE,
      platform: 'Social',
      headAuditorId: headId,
      notes: 'Created by scripts/autoAuditDemo.ts to try the AI app audit against the practice app.',
      dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      status: 'in_progress',
    })
    console.log(`Project created: ${PROJECT_TITLE}`)
  }
  if ((await db.fetchProjectChecklistItems(projectId)).length === 0) {
    await db.syncProjectGuidelines(projectId, [guidelineId])
    await db.initializeProjectChecklists(projectId)
  }
  return projectId
}

async function main(): Promise<void> {
  if (!OWNER) throw new Error('Give the head auditor with --owner <email>.')
  const apiKey = groqKey()
  const secretKey = parseSecretKey(process.env.EVIDENCE_SECRET_KEY)
  if (!secretKey) throw new Error('EVIDENCE_SECRET_KEY is not set: test-account passwords cannot be stored.')
  const admin = getSupabaseAdmin()
  if (!admin) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')

  const users = await db.fetchAllUsers()
  const head = users.find((u) => u.userEmail.toLowerCase() === OWNER.toLowerCase())
  const adminUser = users.find((u) => u.role === 'admin')
  if (!head || head.role !== 'head_auditor') throw new Error(`${OWNER} is not a head auditor account.`)
  if (!adminUser) throw new Error('No admin account found to own the guideline.')

  const guidelineId = await ensureGuideline(adminUser.userId)
  const projectId = await ensureProject(head.userId, guidelineId)
  const checklist = await db.fetchProjectChecklistItems(projectId)
  const wanted = new Map<string, string>(ITEMS.map((i) => [i.text, i.expected]))
  const only = flag('only')?.split(',').map((code) => code.trim().toUpperCase()) ?? null
  const onlyTexts = new Set(ITEMS.filter((i) => only === null || only.includes(i.code)).map((i) => i.text))
  const itemIds = checklist.filter((c) => wanted.has(c.itemDescription) && onlyTexts.has(c.itemDescription)).map((c) => c.itemId)
  if (itemIds.length === 0) throw new Error('The project has none of the six items on its checklist.')

  // The practice app, in a state where every item has a known answer.
  const app = await startSocialApp({
    port: PORT,
    mode: { settingsMenu: true },
    state: { contact: { teen15: { tag: 'Nobody', message: 'Everyone', birthday: null } }, quietMode: { teen15: true }, activityStatus: { teen15: false } },
  })
  console.log(`Practice app running at ${app.url}`)

  const repo = createSupabaseRepository(admin)
  const appRepo = createSupabaseAppRepository(admin)
  await appRepo.saveAppSource(projectId, { appUrl: app.url, loginDomains: [] }, head.userId)
  const accounts = await appRepo.listTestAccounts(projectId)
  for (const a of [
    { label: 'Teen 15', ageGroup: 'under_18' as const, age: 15, loginName: 'teen.login@example.test', handle: 'teen15', password: PASSWORDS.teen15 },
    { label: 'Adult 30', ageGroup: 'adult' as const, age: 30, loginName: 'adult.login@example.test', handle: 'adult30', password: PASSWORDS.adult30 },
  ]) {
    if (accounts.some((x) => x.label === a.label)) continue
    const id = crypto.randomUUID()
    await appRepo.addTestAccount({
      id,
      projectId,
      label: a.label,
      ageGroup: a.ageGroup,
      age: a.age,
      loginName: a.loginName,
      handles: [a.handle],
      passwordCiphertext: encryptSecret(a.password, secretKey, secretAad(projectId, id)),
      createdBy: head.userId,
    })
    console.log(`Test account added: ${a.label}`)
  }
  void LOGIN_NAMES

  const run = await repo.createRun({ projectId, startedBy: head.userId, scope: 'all', source: 'app', checkedItemIds: itemIds, promptVersion: APP_PROMPT_VERSION })
  console.log(`Run ${run.id} started: ${itemIds.length} items, model ${MODEL}. This takes several minutes.`)
  const started = Date.now()
  await runEvidenceJob(run.id, {
    repo,
    screenshots: createSupabaseScreenshotStore(admin),
    audit: createAuditData({ client: () => admin }),
    guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${PORT}`] }),
    apiKey,
    model: MODEL,
    app: { appRepo, secretKey, verifyClaim },
    embedder: null,
  })

  const done = await repo.getRun(run.id)
  const suggestions = await repo.listSuggestions(run.id)
  console.log(`\nRun ${done?.status} in ${Math.round((Date.now() - started) / 1000)} s, ${done?.tokensUsed ?? 0} tokens${done?.error ? `, note: ${done.error}` : ''}.\n`)
  const textOf = new Map(checklist.map((c) => [c.itemId, c.itemDescription]))
  let right = 0
  for (const s of suggestions) {
    const text = textOf.get(s.itemId) ?? s.itemId
    const expected = wanted.get(text)
    const ok = s.suggestedResult === expected
    if (ok) right++
    const steps = await appRepo.listSteps(run.id, s.itemId)
    console.log(`${ok ? 'RIGHT ' : 'WRONG '} ${text}\n       expected ${expected} | suggested ${s.suggestedResult ?? 'no answer'} (${s.confidence}) | ${steps.length} steps | flags: ${s.flags.map((f) => f.type).join(', ') || 'none'}\n       ${s.reason.slice(0, 220).replace(/\s+/g, ' ')}`)
  }
  console.log(`\n${right} of ${itemIds.length} right (${suggestions.length} items got a suggestion).`)
  console.log(`\nOpen the project "${PROJECT_TITLE}" as ${OWNER}. Project id: ${projectId}, run id: ${run.id}`)

  if (KEEP) {
    console.log(`\nThe practice app stays up at ${app.url}. Press Ctrl+C to stop it.`)
    await new Promise(() => undefined)
  }
  await app.close()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
