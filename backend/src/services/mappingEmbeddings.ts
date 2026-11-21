import { createHash } from 'node:crypto'
import { supabase } from '../config/supabase.js'
import type { Embedder } from '../lib/embedder.js'
import { fetchAllRows } from './mappingService.js'

const WRITE_CHUNK = 200

export const textHashOf = (text: string): string => createHash('sha1').update(text).digest('hex')

interface StoredVector {
  itemId: string
  textHash: string
  vector: number[]
}

/**
 * The vector of each item (by lower-case id): read from the table when the item's text has not changed,
 * made and stored otherwise. A failure is logged and gives an empty map, so matching falls back to words.
 */
export async function loadItemVectors(
  items: readonly { itemId: string; text: string }[],
  embedder: Embedder,
): Promise<Map<string, number[]>> {
  try {
    const stored = await fetchAllRows<StoredVector>((from, to) => supabase
      .from('Item_Embedding')
      .select('itemId, textHash, vector')
      .eq('model', embedder.model)
      .order('itemId')
      .range(from, to))
    const have = new Map(stored.map((s) => [s.itemId.toLowerCase(), s]))
    const vectors = new Map<string, number[]>()
    const missing: { itemId: string; text: string; hash: string }[] = []
    for (const item of items) {
      const hash = textHashOf(item.text)
      const found = have.get(item.itemId.toLowerCase())
      if (found && found.textHash === hash) vectors.set(item.itemId.toLowerCase(), found.vector)
      else missing.push({ ...item, hash })
    }
    if (missing.length > 0) {
      const made = await embedder.embed(missing.map((m) => m.text))
      missing.forEach((m, i) => vectors.set(m.itemId.toLowerCase(), made[i]))
      const rows = missing.map((m, i) => ({ itemId: m.itemId, model: embedder.model, textHash: m.hash, vector: made[i], updatedAt: new Date().toISOString() }))
      for (let at = 0; at < rows.length; at += WRITE_CHUNK) {
        const { error } = await supabase.from('Item_Embedding').upsert(rows.slice(at, at + WRITE_CHUNK), { onConflict: 'itemId' })
        // A vector that was made but not stored is still used now; it is only made again next time.
        if (error) console.error('Could not store item vectors:', error)
      }
    }
    return vectors
  } catch (err) {
    console.error('Could not get item vectors, so matching uses words only:', err instanceof Error ? err.message : err)
    return new Map()
  }
}
