/**
 * Items an admin approved as the same requirement form groups: when A is the same as B and A is the same as C,
 * B and C are the same too, so all three are one group. Only "same requirement" links join items into a group.
 * "Partly overlaps" links stay between the two items they name.
 */

export interface GroupEdge {
  itemIdA: string
  itemIdB: string
  relation: 'equivalent' | 'partial'
}

/** A pair of items in one group that no admin linked directly. */
export interface DerivedPair {
  mappingId: string
  itemIdA: string
  itemIdB: string
  relation: 'equivalent'
  derived: true
}

const lower = (id: string) => id.toLowerCase()

/** Every group of two or more items, as sorted lists of lower-case item ids, largest group first. */
export function buildGroups(edges: readonly GroupEdge[], rejected: readonly Pick<GroupEdge, 'itemIdA' | 'itemIdB'>[] = []): string[][] {
  // A link is not followed when it would put two items into one group that an admin said are not the same.
  const refused = new Map<string, Set<string>>()
  for (const r of rejected) {
    const a = lower(r.itemIdA)
    const b = lower(r.itemIdB)
    refused.set(a, (refused.get(a) ?? new Set()).add(b))
    refused.set(b, (refused.get(b) ?? new Set()).add(a))
  }
  const members = new Map<string, Set<string>>()
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    // Point everything on the way at the root, so later lookups are short.
    for (let node = x; node !== root;) { const next = parent.get(node)!; parent.set(node, root); node = next }
    return root
  }
  for (const e of edges) {
    if (e.relation !== 'equivalent') continue
    const a = lower(e.itemIdA)
    const b = lower(e.itemIdB)
    if (!parent.has(a)) { parent.set(a, a); members.set(a, new Set([a])) }
    if (!parent.has(b)) { parent.set(b, b); members.set(b, new Set([b])) }
    const rootA = find(a)
    const rootB = find(b)
    if (rootA === rootB) continue
    const left = members.get(rootA) as Set<string>
    const right = members.get(rootB) as Set<string>
    const blocked = [...left].some((x) => [...(refused.get(x) ?? [])].some((y) => right.has(y)))
    if (blocked) continue
    parent.set(rootA, rootB)
    members.set(rootB, new Set([...left, ...right]))
  }
  const byRoot = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const root = find(id)
    byRoot.set(root, [...(byRoot.get(root) ?? []), id])
  }
  return Array.from(byRoot.values())
    .filter((g) => g.length >= 2)
    .map((g) => g.sort())
    .sort((x, y) => y.length - x.length || x[0].localeCompare(y[0]))
}

/** The group each item belongs to, by lower-case item id. Items in no group are absent. */
export function groupIndex(edges: readonly GroupEdge[], rejected: readonly Pick<GroupEdge, 'itemIdA' | 'itemIdB'>[] = []): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const group of buildGroups(edges, rejected)) for (const id of group) index.set(id, group)
  return index
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * The pairs inside groups that no admin linked directly, so that every two items of a group are linked.
 * `only` limits it to items that matter (for example the items of one project).
 */
export function derivedPairs(edges: readonly GroupEdge[], only?: ReadonlySet<string>, rejected: readonly Pick<GroupEdge, 'itemIdA' | 'itemIdB'>[] = []): DerivedPair[] {
  const direct = new Set(edges.filter((e) => e.relation === 'equivalent').map((e) => pairKey(lower(e.itemIdA), lower(e.itemIdB))))
  const out: DerivedPair[] = []
  for (const group of buildGroups(edges, rejected)) {
    const members = only ? group.filter((id) => only.has(id)) : group
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [a, b] = members[i] < members[j] ? [members[i], members[j]] : [members[j], members[i]]
        if (direct.has(pairKey(a, b))) continue
        out.push({ mappingId: `derived:${a}:${b}`, itemIdA: a, itemIdB: b, relation: 'equivalent', derived: true })
      }
    }
  }
  return out
}
