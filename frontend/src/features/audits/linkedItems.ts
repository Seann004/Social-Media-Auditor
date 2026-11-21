import type { SimilarPair, MappingRelation } from '../../lib/db'

/** An item that an admin linked to another item of the same project. */
export interface LinkedItem {
  /** The project's own id of the other item, which the page scrolls to. */
  itemId: string
  relation: MappingRelation
  guidelineName: string
  /** The code of the other item, or its start when it has none. */
  label: string
}

const LABEL_LENGTH = 28

function labelOf(code: string | null, text: string): string {
  if (code) return code
  return text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH).trimEnd()}…` : text
}

/** For each project item, the items linked to it. A pair appears on both of its items, pointing at the other. */
export function linkedItemsByItem(pairs: readonly SimilarPair[]): Record<string, LinkedItem[]> {
  const out: Record<string, LinkedItem[]> = {}
  const add = (from: string, to: LinkedItem) => { out[from] = [...(out[from] ?? []), to] }
  for (const p of pairs) {
    add(p.projectItemIdA, { itemId: p.projectItemIdB, relation: p.relation, guidelineName: p.itemB.guidelineName, label: labelOf(p.itemB.itemCode, p.itemB.text) })
    add(p.projectItemIdB, { itemId: p.projectItemIdA, relation: p.relation, guidelineName: p.itemA.guidelineName, label: labelOf(p.itemA.itemCode, p.itemA.text) })
  }
  return out
}
