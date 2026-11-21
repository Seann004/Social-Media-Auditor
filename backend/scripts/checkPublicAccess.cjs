// Checks security finding S-0: what the public anon key (the one in the browser bundle) can still do.
// Run from backend/:  node scripts/checkPublicAccess.cjs
// Read-only: it only tries to read, and tries one update aimed at a row id that cannot exist.
// Exit code 0 = locked down as intended, 1 = something is still open.
const path = require('path')
const req = require('module').createRequire(path.resolve(__dirname, '..', 'package.json'))
req('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
const { createClient } = req('@supabase/supabase-js')

const TABLES = [
  'AI_Suggestion', 'AI_Suggestion_Decision', 'AI_Suggestion_Quote', 'Audit_Project', 'Audit_Report', 'Audit_Result',
  'Checklist', 'Checklist_Item', 'Checklist_Resolution', 'Evidence_App_Change', 'Evidence_App_Source', 'Evidence_App_Step',
  'Evidence_Page', 'Evidence_Passage', 'Evidence_Permission', 'Evidence_Repo_Piece', 'Evidence_Repo_Snapshot',
  'Evidence_Repo_Source', 'Evidence_Run', 'Evidence_Source', 'Evidence_Test_Account', 'Item_Mapping', 'Project_Member',
  'Project_Scope', 'Suggestion_Decision', 'User',
]
const PUBLIC_ON_PURPOSE = new Set(['Guideline'])
const NO_ROW = '00000000-0000-0000-0000-000000000000'

async function main() {
  const url = process.env.SUPABASE_URL
  const anon = createClient(url, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const open = []

  for (const table of TABLES) {
    const { data, error } = await anon.from(table).select('*').limit(1)
    const readable = !error && Array.isArray(data) && data.length > 0
    // An empty table reads as [] either way; ask the service role whether there was anything to see.
    const { count } = await service.from(table).select('*', { count: 'exact', head: true })
    const status = error ? `refused (${error.code ?? error.message})` : readable ? 'READABLE' : count ? 'no rows visible (locked)' : 'empty table, read not refused'
    if (readable || (!error && !count)) open.push(`${table}: ${status}`)
    console.log(`${table.padEnd(24)} ${status}`)
  }

  const write = await anon.from('Item_Mapping').update({ rationale: null }).eq('mappingId', NO_ROW).select()
  const writeStatus = write.error ? `refused (${write.error.code ?? write.error.message})` : 'ACCEPTED'
  if (!write.error) open.push(`Item_Mapping update: ${writeStatus}`)
  console.log(`${'update Item_Mapping'.padEnd(24)} ${writeStatus}`)

  const login = await anon.rpc('verify_user_login', { p_email: 'nobody@example.test', p_password: 'x' })
  const loginStatus = login.error ? `refused (${login.error.code ?? login.error.message})` : 'CALLABLE'
  if (!login.error) open.push(`verify_user_login: ${loginStatus}`)
  console.log(`${'rpc verify_user_login'.padEnd(24)} ${loginStatus}`)

  for (const table of PUBLIC_ON_PURPOSE) {
    const { error } = await anon.from(table).select('guidelineId').limit(1)
    console.log(`${table.padEnd(24)} ${error ? `refused (${error.code})` : 'readable (on purpose, for live guideline updates)'}`)
  }

  console.log(open.length ? `\nSTILL OPEN:\n- ${open.join('\n- ')}` : '\nLocked: the anon key can read or change nothing but the guideline list.')
  process.exit(open.length ? 1 : 0)
}

main().catch((e) => { console.error('check failed:', e.message); process.exit(2) })
