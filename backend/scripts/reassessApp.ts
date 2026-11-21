/**
 * Judges the steps an earlier app run recorded again, with the current judge, without opening the app.
 * It makes a new run in the same project (the earlier run is not changed) and prints the new suggestion per item.
 *
 * Run from backend/:  npx tsx scripts/reassessApp.ts --project <projectId> --from <earlierRunId> --items <itemId-prefix,...>
 *   --key-env NAME   the environment variable holding the Groq key (default GROQ_API_KEY2, then GROQ_API_KEY)
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
  const given = flag('key-env')
  for (const name of given ? [given] : ['GROQ_API_KEY2', 'GROQ_API_KEY']) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  throw new Error('No Groq key found.')
}

async function main(): Promise<void> {
  const projectId = flag('project')
  const from = flag('from')
  const prefixes = flag('items')?.split(',').map((x) => x.trim()) ?? []
  if (!projectId || !from || prefixes.length === 0) throw new Error('Give --project, --from (the earlier run id) and --items (item id prefixes).')
  const secretKey = parseSecretKey(process.env.EVIDENCE_SECRET_KEY)
  const admin = getSupabaseAdmin()
  if (!secretKey || !admin) throw new Error('EVIDENCE_SECRET_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.')

  const repo = createSupabaseRepository(admin)
  const appRepo = createSupabaseAppRepository(admin)
  const { data: project } = await admin.from('Audit_Project').select('headAuditorId').eq('projectId', projectId).maybeSingle()
  if (!project) throw new Error('Project not found.')
  const checklist = await db.fetchProjectChecklistItems(projectId)
  const picked = checklist.filter((c) => prefixes.some((prefix) => c.itemId.startsWith(prefix)))
  if (picked.length === 0) throw new Error('No checklist items match.')

  const run = await repo.createRun({
    projectId,
    startedBy: project.headAuditorId,
    scope: 'all',
    source: 'app',
    capturedInRunId: from,
    checkedItemIds: picked.map((c) => c.itemId),
    promptVersion: APP_PROMPT_VERSION,
  })
  console.log(`Re-judging ${picked.length} item(s) from run ${from} as run ${run.id}, model ${MODEL}.`)
  await runEvidenceJob(run.id, {
    repo,
    screenshots: createSupabaseScreenshotStore(admin),
    audit: createAuditData({ client: () => admin }),
    guard: createUrlGuard({}),
    apiKey: groqKey(),
    model: MODEL,
    app: { appRepo, secretKey, verifyClaim },
    embedder: null,
  })

  const done = await repo.getRun(run.id)
  console.log(`\nRun ${done?.status}, ${done?.tokensUsed ?? 0} tokens${done?.error ? `, note: ${done.error}` : ''}.\n`)
  const texts = new Map(checklist.map((c) => [c.itemId, c.itemDescription]))
  for (const s of await repo.listSuggestions(run.id)) {
    if (!picked.some((c) => c.itemId === s.itemId)) continue
    console.log(`${texts.get(s.itemId)}\n  suggested ${s.suggestedResult ?? 'no answer'} (${s.confidence}) | flags: ${s.flags.map((f) => f.type).join(', ') || 'none'}\n  ${s.reason.slice(0, 300).replace(/\s+/g, ' ')}\n`)
  }
  console.log(`Run id: ${run.id}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
