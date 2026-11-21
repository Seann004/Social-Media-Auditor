/**
 * Runs the AI app audit on a project that already has its app address and test accounts set up, and leaves
 * everything in the database so the result can be opened in the browser.
 *
 * Run from backend/:  npx tsx scripts/runAppAudit.ts --project <projectId> [--only <itemId-prefix,...>]
 *   --key-env NAME   the environment variable holding the Groq key (default GROQ_API_KEY2, then GROQ_API_KEY)
 *
 * The app is whatever the project's app source says. Nothing is created or deleted except the run and its steps.
 */
import 'dotenv/config'
import { getSupabaseAdmin } from '../src/config/supabaseAdmin.js'
import { createAuditData } from '../src/features/evidence/auditData.js'
import { verifyClaim } from '../src/features/evidence/claimCheck.js'
import { APP_PROMPT_VERSION } from '../src/features/evidence/config.js'
import { runEvidenceJob } from '../src/features/evidence/runner.js'
import { parseSecretKey } from '../src/features/evidence/secrets.js'
import { createSupabaseAppRepository } from '../src/features/evidence/supabaseAppRepository.js'
import { createSupabaseRepository, createSupabaseScreenshotStore } from '../src/features/evidence/supabaseRepository.js'
import { createUrlGuard } from '../src/features/evidence/urlGuard.js'
import * as db from '../src/services/dbService.js'

const MODEL = process.env.EVIDENCE_GROQ_MODEL || 'openai/gpt-oss-120b'
const args = process.argv.slice(2)
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? (args[at + 1] ?? '') : null
}

function groqKey(): string {
  const names = flag('key-env') ? [flag('key-env') as string] : ['GROQ_API_KEY2', 'GROQ_API_KEY']
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  throw new Error(`No Groq key found in ${names.join(' or ')}.`)
}

async function main(): Promise<void> {
  const projectId = flag('project')
  if (!projectId) throw new Error('Give the project with --project <projectId>.')
  const secretKey = parseSecretKey(process.env.EVIDENCE_SECRET_KEY)
  if (!secretKey) throw new Error('EVIDENCE_SECRET_KEY is not set: test-account passwords cannot be read.')
  const admin = getSupabaseAdmin()
  if (!admin) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')

  const repo = createSupabaseRepository(admin)
  const appRepo = createSupabaseAppRepository(admin)
  const source = await appRepo.getAppSource(projectId)
  if (!source) throw new Error('This project has no app address set.')
  const accounts = await appRepo.listTestAccounts(projectId)
  if (accounts.length === 0) throw new Error('This project has no test accounts.')
  const { data: project } = await admin.from('Audit_Project').select('projectTitle,headAuditorId').eq('projectId', projectId).maybeSingle()
  if (!project) throw new Error('Project not found.')

  const only = flag('only')?.split(',').map((x) => x.trim()) ?? null
  const checklist = await db.fetchProjectChecklistItems(projectId)
  const picked = checklist.filter((c) => only === null || only.some((prefix) => c.itemId.startsWith(prefix)))
  if (picked.length === 0) throw new Error('No checklist items to run.')

  console.log(`Project: ${project.projectTitle}\nApp: ${source.appUrl}\nAccounts: ${accounts.map((a) => `${a.label} (${a.ageGroup})`).join(', ')}`)
  const run = await repo.createRun({ projectId, startedBy: project.headAuditorId, scope: 'all', source: 'app', checkedItemIds: picked.map((c) => c.itemId), promptVersion: APP_PROMPT_VERSION })
  console.log(`Run ${run.id} started: ${picked.length} items, model ${MODEL}. This takes several minutes.`)
  const started = Date.now()
  const host = new URL(source.appUrl).host
  await runEvidenceJob(run.id, {
    repo,
    screenshots: createSupabaseScreenshotStore(admin),
    audit: createAuditData({ client: () => admin }),
    guard: createUrlGuard({ allowedPrivateHosts: [host] }),
    apiKey: groqKey(),
    model: MODEL,
    app: { appRepo, secretKey, verifyClaim },
    embedder: null,
  })

  const done = await repo.getRun(run.id)
  const suggestions = await repo.listSuggestions(run.id)
  console.log(`\nRun ${done?.status} in ${Math.round((Date.now() - started) / 1000)} s, ${done?.tokensUsed ?? 0} tokens${done?.error ? `, note: ${done.error}` : ''}.\n`)
  const textOf = new Map(checklist.map((c) => [c.itemId, c.itemDescription]))
  for (const s of suggestions) {
    const steps = await appRepo.listSteps(run.id, s.itemId)
    console.log(`${textOf.get(s.itemId) ?? s.itemId}\n  suggested ${s.suggestedResult ?? 'no answer'} (${s.confidence}) | ${steps.length} steps | flags: ${s.flags.map((f) => f.type).join(', ') || 'none'}\n  ${s.reason.slice(0, 260).replace(/\s+/g, ' ')}\n`)
  }
  console.log(`Run id: ${run.id}  Project id: ${projectId}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
