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

/** An item with more links than this shows the first ones and a "+N more" button. */
export const VISIBLE_LINKS = 2

/** The links to show: all of them when expanded or when there are few, otherwise the first ones. */
export function visibleLinks<T>(links: readonly T[], expanded: boolean): { shown: T[]; hidden: number } {
  if (expanded || links.length <= VISIBLE_LINKS) return { shown: [...links], hidden: 0 }
  return { shown: links.slice(0, VISIBLE_LINKS), hidden: links.length - VISIBLE_LINKS }
}

type Answer = string | undefined

/**
 * The same-requirement items whose answer differs from this item's, once the group holds two different answers.
 * An item that is not answered yet is compared among its linked items only. Unanswered and flagged items are ignored.
 */
export function disagreeingLinks(links: readonly LinkedItem[], ownAnswer: Answer, answerOf: (itemId: string) => Answer): LinkedItem[] {
  const counts = (a: Answer) => !!a && a !== 'not_started' && a !== 'needs_review'
  const answered = links
    .filter((l) => l.relation === 'equivalent')
    .map((l) => ({ link: l, answer: answerOf(l.itemId) }))
    .filter((x) => counts(x.answer))
  const all = new Set([...(counts(ownAnswer) ? [ownAnswer] : []), ...answered.map((x) => x.answer)])
  if (all.size < 2) return []
  return answered.filter((x) => !counts(ownAnswer) || x.answer !== ownAnswer).map((x) => x.link)
}
