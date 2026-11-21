import { supabase } from '../config/supabase.js'
import { fetchAllRows } from './mappingService.js'

/** Bump when MATCH_PROMPT changes meaning, so pairs are compared again under the new prompt. */
export const MATCH_PROMPT_VERSION = 'match-v2'

const WRITE_CHUNK = 500

export const pairKeyOf = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * The pairs already compared under the current prompt, as lower-case "a|b" keys. A ledger that cannot be
 * read (for example the table is not created yet) is logged and treated as empty: matching still works,
 * it only compares more pairs than it needs to.
 */
export async function loadCheckedPairs(): Promise<Set<string>> {
  try {
    const rows = await fetchAllRows<{ itemIdA: string; itemIdB: string }>((from, to) => supabase
      .from('Mapping_Checked')
      .select('itemIdA, itemIdB')
      .eq('promptVersion', MATCH_PROMPT_VERSION)
      .order('itemIdA')
      .order('itemIdB')
      .range(from, to))
    return new Set(rows.map((r) => pairKeyOf(r.itemIdA.toLowerCase(), r.itemIdB.toLowerCase())))
  } catch (err) {
    console.error('Could not read the checked-pairs ledger, so every pair is compared again:', err)
    return new Set()
  }
}

/** Records pairs the AI has compared. Never throws: a failed write only means the pair is compared again later. */
export async function recordCheckedPairs(pairKeys: readonly string[]): Promise<void> {
  const rows = pairKeys.map((key) => {
    const [itemIdA, itemIdB] = key.split('|')
    return { itemIdA, itemIdB, promptVersion: MATCH_PROMPT_VERSION }
  })
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    try {
      const { error } = await supabase
        .from('Mapping_Checked')
        .upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: 'itemIdA,itemIdB,promptVersion', ignoreDuplicates: true })
      if (error) throw error
    } catch (err) {
      console.error('Could not record the checked pairs:', err)
      return
    }
  }
}
