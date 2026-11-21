/**
 * Test data for the "similar items" feature: two small guidelines whose items overlap, and admin-approved links
 * between them, some "same requirement" (equivalent) and some "partly overlaps" (partial).
 *
 * Run from backend/:  npx tsx scripts/seedOverlap.ts
 * Safe to run twice: guidelines that already exist are reused and existing links are left alone.
 * Remove later by deleting the two guidelines in the Admin screen (their links are deleted with their items).
 */
import crypto from 'crypto'
import { supabase } from '../src/config/supabase.js'
import * as db from '../src/services/dbService.js'

const NAME_A = 'Overlap Test A (Code)'
const NAME_B = 'Overlap Test B (Rules)'

interface SeedItem { code: string; category: string; severity: 'critical' | 'major' | 'minor'; text: string }

const ITEMS_A: readonly SeedItem[] = [
  { code: 'A-1', category: 'Privacy', severity: 'critical', text: 'Accounts of users under 16 are private by default.' },
  { code: 'A-2', category: 'Privacy', severity: 'major', text: 'Location sharing is off by default for child accounts.' },
  { code: 'A-3', category: 'Reporting', severity: 'major', text: 'Users can report a video, comment or account from the app.' },
  { code: 'A-4', category: 'Age checks', severity: 'major', text: 'The platform checks the age of new users at sign-up.' },
  { code: 'A-5', category: 'Reporting', severity: 'minor', text: 'A safety centre explains the tools available to teens and parents.' },
]

const ITEMS_B: readonly SeedItem[] = [
  { code: 'B-1', category: 'Privacy', severity: 'critical', text: 'Profiles of children are set to private unless the child chooses otherwise.' },
  { code: 'B-2', category: 'Privacy', severity: 'major', text: 'Geolocation is switched off by default and the child is shown a clear warning before it is turned on.' },
  { code: 'B-3', category: 'Reporting', severity: 'major', text: 'Children can report harmful content and accounts with a visible report button.' },
  { code: 'B-4', category: 'Age checks', severity: 'major', text: 'Age is verified at sign-up and again before access to sensitive features.' },
  { code: 'B-5', category: 'Data', severity: 'minor', text: 'Data collected from children is deleted when the account is closed.' },
]

/** Which pairs to link: [item in A, item in B, relation, confidence, reason]. A-5 and B-5 are left unlinked on purpose. */
const LINKS = [
  ['A-1', 'B-1', 'equivalent', 0.93, 'Both require child accounts to be private by default.'],
  ['A-2', 'B-2', 'partial', 0.72, 'Both turn location off by default, but the other item also requires a warning before it is turned on.'],
  ['A-3', 'B-3', 'equivalent', 0.88, 'Both require a way to report content and accounts.'],
  ['A-4', 'B-4', 'partial', 0.66, 'Both check age at sign-up, but the other item adds a second check before sensitive features.'],
] as const

async function adminUserId(): Promise<string> {
  const users = await db.fetchAllUsers()
  const admin = users.find((u) => u.role === 'admin') ?? users[0]
  if (!admin) throw new Error('No users found. Create an account first (for example with scripts/seedDemo.ts).')
  return admin.userId
}

async function ensureGuideline(name: string, shortName: string, items: readonly SeedItem[], userId: string): Promise<Map<string, string>> {
  const { data: found, error } = await supabase.from('Guideline').select('guidelineId').eq('guidelineName', name).is('projectId', null)
  if (error) throw error
  const existing = (found ?? []) as { guidelineId: string }[]

  if (existing.length === 0) {
    await db.createGuideline({
      guideline: {
        guidelineId: crypto.randomUUID(),
        guidelineName: name,
        shortName,
        version: '1.0',
        description: 'Test guideline for similar-item links.',
        source: 'Test data',
        categories: Array.from(new Set(items.map((i) => i.category))),
        lastUpdated: new Date().toISOString().slice(0, 10),
        userId,
      },
      items: items.map((i) => ({ id: crypto.randomUUID(), category: i.category, severity: i.severity, itemCode: i.code, text: i.text })),
    })
    console.log(`Created guideline: ${name}`)
  } else {
    console.log(`Guideline exists, reused: ${name}`)
  }

  const { data: guideline, error: gError } = await supabase.from('Guideline').select('guidelineId').eq('guidelineName', name).is('projectId', null).single()
  if (gError) throw gError
  const { data: checklist, error: cError } = await supabase.from('Checklist').select('checklistId').eq('guidelineId', (guideline as any).guidelineId).is('projectId', null).single()
  if (cError) throw cError
  const { data: rows, error: iError } = await supabase.from('Checklist_Item').select('itemId, itemCode').eq('checklistId', (checklist as any).checklistId)
  if (iError) throw iError
  return new Map(((rows ?? []) as { itemId: string; itemCode: string }[]).map((r) => [r.itemCode, r.itemId]))
}

async function main() {
  const userId = await adminUserId()
  const a = await ensureGuideline(NAME_A, 'TESTA', ITEMS_A, userId)
  const b = await ensureGuideline(NAME_B, 'TESTB', ITEMS_B, userId)

  for (const [codeA, codeB, relation, confidence, rationale] of LINKS) {
    const idA = a.get(codeA)
    const idB = b.get(codeB)
    if (!idA || !idB) throw new Error(`Item ${codeA} or ${codeB} was not found.`)
    // The table stores each pair once, with the smaller id first.
    const [itemIdA, itemIdB] = idA.toLowerCase() < idB.toLowerCase() ? [idA, idB] : [idB, idA]
    const { error } = await supabase.from('Item_Mapping').upsert(
      { itemIdA, itemIdB, relation, aiRelation: relation, confidence, rationale, status: 'confirmed', reviewedBy: userId, reviewedAt: new Date().toISOString(), reviewMethod: 'single' },
      { onConflict: 'itemIdA,itemIdB', ignoreDuplicates: true },
    )
    if (error) throw error
    console.log(`Link ${codeA} <-> ${codeB}: ${relation} (confirmed)`)
  }
  console.log('\nDone. Next: as head auditor, create a project on any platform with BOTH test guidelines, assign the auditor.')
}

main().catch((err) => { console.error(err); process.exit(1) })
