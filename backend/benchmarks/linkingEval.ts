/**
 * Measures same-item linking against a labelled set, and writes nothing to Item_Mapping.
 *
 * The labelled set is the seeded overlap guidelines (scripts/seedOverlap.ts): every cross-guideline pair of their
 * items is labelled, as linked (an approved link, or two items of one "same requirement" group) or not linked.
 *
 *   Stage 1, candidates: for each seeded item, is its linked partner among the candidates chosen from the WHOLE library,
 *            by words alone, and by words and meaning (the embedder from the environment)?
 *   Stage 2, AI: the real matching prompt and model on every labelled pair; precision, recall, relation, confidence.
 *   Stage 3, library: how many candidates each method sends to the AI, and how many of the earlier AI suggestions are kept.
 *
 * Run from backend/:  npx tsx benchmarks/linkingEval.ts [--repeats 3] [--label name]
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createEmbedder } from '../src/lib/embedder.js'
import { askMappingModel } from '../src/services/mappingAi.js'
import { buildGroups } from '../src/services/mappingGroups.js'
import { loadItemVectors } from '../src/services/mappingEmbeddings.js'
import {
  candidatePicker,
  fetchGlobalItems,
  fetchMappingRows,
  itemText,
  MATCH_PROMPT,
  MIN_SEMANTIC_SIMILARITY,
  resolveMappingModel,
  type GlobalItem,
} from '../src/services/mappingService.js'
import { getAiUsage } from '../src/lib/aiUsage.js'

const SEEDED = ['TESTA', 'TESTB', 'TESTC']
const args = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const REPEATS = Number(flag('repeats', '3'))
const LABEL = flag('label', 'linking')

const key = (a: string, b: string): string => (a.toLowerCase() < b.toLowerCase() ? `${a.toLowerCase()}|${b.toLowerCase()}` : `${b.toLowerCase()}|${a.toLowerCase()}`)
const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}% (${n} of ${d})`)
const out: string[] = []
const say = (line = ''): void => {
  console.log(line)
  out.push(line)
}

async function main(): Promise<void> {
  const library = await fetchGlobalItems()
  const rows = await fetchMappingRows()
  const seeded = library.filter((i) => SEEDED.includes(i.shortName ?? ''))
  if (seeded.length === 0) throw new Error('The seeded overlap guidelines are not in the database. Run scripts/seedOverlap.ts first.')
  const name = (i: GlobalItem): string => `${i.itemCode} ${i.shortName}`
  const byId = new Map(library.map((i) => [i.itemId.toLowerCase(), i]))

  // ----- the labels
  const seededIds = new Set(seeded.map((i) => i.itemId.toLowerCase()))
  const confirmed = rows.filter((r) => r.status === 'confirmed' && seededIds.has(r.itemIdA.toLowerCase()) && seededIds.has(r.itemIdB.toLowerCase()))
  const groups = buildGroups(confirmed)
  const positive = new Map<string, 'equivalent' | 'partial'>()
  for (const r of confirmed) positive.set(key(r.itemIdA, r.itemIdB), r.relation)
  for (const g of groups) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (!positive.has(key(g[i], g[j]))) positive.set(key(g[i], g[j]), 'equivalent')
  const pairs: { a: GlobalItem; b: GlobalItem }[] = []
  for (let i = 0; i < seeded.length; i++) for (let j = i + 1; j < seeded.length; j++) if (seeded[i].guidelineId !== seeded[j].guidelineId) pairs.push({ a: seeded[i], b: seeded[j] })

  say(`# Linking evaluation: ${LABEL}`)
  say()
  say(`- Date: ${new Date().toISOString()}`)
  say(`- Matching model: ${resolveMappingModel(process.env)}`)
  const embedder = createEmbedder()
  say(`- Embedder: ${embedder ? embedder.model : 'none (words only)'}; semantic threshold ${MIN_SEMANTIC_SIMILARITY}`)
  say(`- Library: ${library.length} items in ${new Set(library.map((i) => i.guidelineId)).size} guidelines. Labelled set: ${seeded.length} seeded items, ${pairs.length} cross-guideline pairs, ${positive.size} linked and ${pairs.length - positive.size} not linked.`)
  say()

  // ----- stage 1: candidates from the whole library
  const vectors = embedder ? await loadItemVectors(library.map((i) => ({ itemId: i.itemId, text: itemText(i) })), embedder) : new Map<string, number[]>()
  say(`## Stage 1: does the right partner reach the AI? (candidates chosen from all ${library.length} items)`)
  say()
  const methods: [string, ReturnType<typeof candidatePicker>][] = [['words only', candidatePicker(library, new Map())]]
  if (vectors.size > 0) methods.push(['words + meaning', candidatePicker(library, vectors)])
  const hit = new Map<string, Set<string>>()
  for (const [label, pick] of methods) {
    const found = new Set<string>()
    for (const item of seeded) {
      const others = library.filter((o) => o.guidelineId !== item.guidelineId)
      const picked = candidatePicker(others, label === 'words only' ? new Map() : vectors)(item)
      for (const c of picked) found.add(key(item.itemId, c.itemId))
    }
    void pick
    hit.set(label, found)
  }
  say('| Method | Linked pairs offered to the AI | Missed |')
  say('| --- | --- | --- |')
  for (const [label] of methods) {
    const found = hit.get(label) as Set<string>
    const missed = [...positive.keys()].filter((k) => !found.has(k))
    say(`| ${label} | ${pct(positive.size - missed.length, positive.size)} | ${missed.map((k) => k.split('|').map((id) => name(byId.get(id) as GlobalItem)).join(' / ')).join('; ') || 'none'} |`)
  }
  say()

  // ----- stage 2: the AI on every labelled pair, as the real prompt sees them
  say(`## Stage 2: the AI on every labelled pair (${REPEATS} repeats; every pair is shown as a candidate)`)
  say()
  const sources = new Map<string, GlobalItem[]>()
  for (const { a, b } of pairs) {
    const [source, candidate] = a.shortName === 'TESTC' || (a.shortName === 'TESTB' && b.shortName === 'TESTA') ? [b, a] : [a, b]
    sources.set(source.itemId, [...(sources.get(source.itemId) ?? []), candidate])
  }
  let tp = 0, fp = 0, fn = 0, tn = 0, relationRight = 0, relationTotal = 0
  const confTp: number[] = []
  const confFp: number[] = []
  const wrong: string[] = []
  const unstable = new Map<string, Set<string>>()
  let stage2Error: string | null = null
  let repeatsDone = 0
  try {
    for (let r = 0; r < REPEATS; r++) {
      const refs = new Map<string, string>()
      let n = 0
      const batch = [...sources.entries()].map(([id, candidates], s) => {
        const source = byId.get(id.toLowerCase()) as GlobalItem
        refs.set(`S${s + 1}`, source.itemId)
        return {
          source: `S${s + 1}`,
          text: source.itemDescription,
          clause: (source.verbatimClauseText ?? '').slice(0, 150),
          candidates: candidates.map((c) => {
            refs.set(`C${++n}`, c.itemId)
            return { candidate: `C${n}`, guideline: c.shortName || c.guidelineName, text: c.itemDescription }
          }),
        }
      })
      const reply = (await askMappingModel(MATCH_PROMPT, JSON.stringify(batch))) as { matches?: { source: string; candidate: string; relation: string; confidence: number }[] }
      const predicted = new Map<string, { relation: string; confidence: number }>()
      for (const m of reply.matches ?? []) {
        const s = refs.get(m.source)
        const c = refs.get(m.candidate)
        if (s && c) predicted.set(key(s, c), { relation: m.relation === 'equivalent' ? 'equivalent' : 'partial', confidence: Number(m.confidence) })
      }
      repeatsDone++
      for (const { a, b } of pairs) {
        const k = key(a.itemId, b.itemId)
        const truth = positive.get(k)
        const guess = predicted.get(k)
        unstable.set(k, (unstable.get(k) ?? new Set()).add(guess ? guess.relation : 'none'))
        if (truth && guess) {
          tp++
          confTp.push(guess.confidence)
          relationTotal++
          if (guess.relation === truth) relationRight++
          else wrong.push(`${name(a)} / ${name(b)}: said ${guess.relation}, label ${truth}`)
        } else if (truth && !guess) {
          fn++
          wrong.push(`MISSED ${name(a)} / ${name(b)} (label ${truth})`)
        } else if (!truth && guess) {
          fp++
          confFp.push(guess.confidence)
          wrong.push(`EXTRA ${name(a)} / ${name(b)}: said ${guess.relation} at ${guess.confidence}`)
        } else tn++
      }
    }

  } catch (err) {
    stage2Error = err instanceof Error ? err.message : String(err)
  }
  if (stage2Error) say(`Stage 2 stopped after ${repeatsDone} of ${REPEATS} repeats: ${stage2Error}`)
  if (stage2Error) say()
  const precision = tp / (tp + fp || 1)
  const recall = tp / (tp + fn || 1)
  const mean = (xs: number[]): string => (xs.length === 0 ? 'n/a' : (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2))
  say('| Measure | Result |')
  say('| --- | --- |')
  say(`| Pair decisions scored | ${tp + fp + fn + tn} (${repeatsDone} repeats of ${pairs.length} pairs) |`)
  say(`| True matches found (recall) | ${pct(tp, tp + fn)} |`)
  say(`| Matches that were right (precision) | ${pct(tp, tp + fp)} |`)
  say(`| F1 | ${((2 * precision * recall) / (precision + recall || 1)).toFixed(3)} |`)
  say(`| Non-links left alone | ${pct(tn, tn + fp)} |`)
  say(`| Relation right (equivalent or partial), among found matches | ${pct(relationRight, relationTotal)} |`)
  say(`| Mean confidence: right matches / wrong matches | ${mean(confTp)} / ${mean(confFp)} |`)
  say(`| Pairs whose answer changed between repeats | ${[...unstable.values()].filter((s) => s.size > 1).length} of ${pairs.length} |`)
  say()
  if (wrong.length > 0) {
    say('Mistakes (every repeat):')
    for (const w of [...new Set(wrong)]) say(`- ${w}`)
    say()
  }

  // ----- stage 3: the whole library
  say('## Stage 3: the whole library (no labels; cost and change only)')
  say()
  const guidelines = [...new Set(library.map((i) => i.guidelineId))]
  const count = (useVectors: boolean): { pairs: Set<string>; perItem: number[] } => {
    const found = new Set<string>()
    const perItem: number[] = []
    for (const g of guidelines) {
      const others = library.filter((o) => o.guidelineId !== g)
      const pick = candidatePicker(others, useVectors ? vectors : new Map())
      for (const item of library.filter((i) => i.guidelineId === g)) {
        const c = pick(item)
        perItem.push(c.length)
        c.forEach((x) => found.add(key(item.itemId, x.itemId)))
      }
    }
    return { pairs: found, perItem }
  }
  const words = count(false)
  const both = vectors.size > 0 ? count(true) : null
  const earlier = new Set(rows.map((r) => key(r.itemIdA, r.itemIdB)))
  say('| Method | Distinct pairs sent to the AI | Items with 5 candidates | Earlier AI suggestions and approved links still offered |')
  say('| --- | --- | --- | --- |')
  const kept = (s: Set<string>): string => pct([...earlier].filter((k) => s.has(k)).length, earlier.size)
  say(`| words only | ${words.pairs.size} | ${words.perItem.filter((n) => n === 5).length} of ${words.perItem.length} | ${kept(words.pairs)} |`)
  if (both) {
    say(`| words + meaning | ${both.pairs.size} | ${both.perItem.filter((n) => n === 5).length} of ${both.perItem.length} | ${kept(both.pairs)} |`)
    const added = [...both.pairs].filter((k) => !words.pairs.has(k))
    say()
    say(`Meaning search adds ${added.length} pairs that words alone never offered, and drops ${[...words.pairs].filter((k) => !both.pairs.has(k)).length}.`)
    const sheet = added
      .map((k) => {
        const [x, y] = k.split('|').map((id) => byId.get(id) as GlobalItem)
        return { x, y }
      })
      .slice(0, 40)
    say()
    say('A sample of the added pairs, for a person to label (are they really the same requirement?):')
    say()
    for (const { x, y } of sheet) say(`- [ ] **${name(x)}**: ${x.itemDescription.slice(0, 140)}  \n  **${name(y)}**: ${y.itemDescription.slice(0, 140)}`)
  }
  say()
  say(`AI usage during this evaluation: ${JSON.stringify(getAiUsage())}`)

  mkdirSync('../docs/testing/benchmarks', { recursive: true })
  writeFileSync(`../docs/testing/benchmarks/${new Date().toISOString().slice(0, 10)}-${LABEL}.md`, `${out.join('\n')}\n`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
