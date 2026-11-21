/**
 * Measures how well page evidence finds the passage that answers a checklist item: by keywords alone, and by
 * keywords and meaning together (the real searchForItem, with the embedder from the environment). It calls no
 * chat model, only the embedding service, and writes nothing to the database.
 *
 * The test set is written by hand: 16 checklist questions, each with one passage that answers it, hidden among
 * ~40 other passages, some of them about nearby topics on purpose. Six answers reuse the question's words ("lexical"),
 * ten say the same thing in other words ("paraphrase"). The keyword arm is a simplified version of the Postgres
 * full-text search in production (stop words dropped, words cut to their stems, any matching word counts).
 *
 * Run from backend/:  npx tsx benchmarks/retrievalEval.ts [--label name]
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createEmbedder } from '../src/lib/embedder.js'
import { createMemoryRepository } from '../src/features/evidence/memoryRepository.js'
import { HYBRID_POOL, MIN_PASSAGE_SIMILARITY, searchForItem } from '../src/features/evidence/passageSearch.js'
import type { RunCtx } from '../src/features/evidence/runnerShared.js'
import type { Passage } from '../src/features/evidence/types.js'

interface Case {
  kind: 'lexical' | 'paraphrase'
  question: string
  answer: string
}

const CASES: Case[] = [
  { kind: 'lexical', question: 'Can users report a post for abuse?', answer: 'Every post has a Report button that lets anyone report abuse to our safety team.' },
  { kind: 'lexical', question: 'Is there a minimum age to create an account?', answer: 'You must be at least 13 years old to create an account.' },
  { kind: 'lexical', question: 'Can users block other accounts?', answer: 'You can block any account from its profile, and blocked accounts cannot message you.' },
  { kind: 'lexical', question: 'Are accounts of users under 18 private by default?', answer: 'Accounts created by users under 18 are private by default.' },
  { kind: 'lexical', question: 'Can users delete their account and their data?', answer: 'You can delete your account and all your data from the settings page.' },
  { kind: 'lexical', question: 'Can users download a copy of their data?', answer: 'Use the download option in settings to download a copy of your data.' },
  { kind: 'paraphrase', question: 'Is location sharing off by default for child accounts?', answer: "A child's whereabouts are never shown on a map unless a parent switches that feature on." },
  { kind: 'paraphrase', question: 'Does the platform verify the age of users at sign-up?', answer: 'New members are asked to confirm their date of birth and prove it with an ID or a face scan before joining.' },
  { kind: 'paraphrase', question: 'Are strangers prevented from sending direct messages to teens?', answer: 'Only people a young member already follows back can start a private conversation with them.' },
  { kind: 'paraphrase', question: 'Are personalised ads switched off for under-18s?', answer: 'Advertisers cannot use the interests of minors to choose which promotions appear in their feed.' },
  { kind: 'paraphrase', question: 'Is harmful content removed within 24 hours of being reported?', answer: 'Our reviewers look at flagged material round the clock and take unsafe items down the same day.' },
  { kind: 'paraphrase', question: 'Do parents have controls to limit screen time?', answer: 'Guardians can set a daily cap on how long a young person spends in the app.' },
  { kind: 'paraphrase', question: 'Are notifications silenced at night for teen accounts?', answer: 'Between ten in the evening and seven in the morning, alerts are muted for younger users.' },
  { kind: 'paraphrase', question: 'Is data from children deleted when the account is closed?', answer: 'When a young person leaves the service, everything we hold about them is erased.' },
  { kind: 'paraphrase', question: 'Are live streams restricted for users under 16?', answer: 'Going live is only available to members who have reached sixteen.' },
  { kind: 'paraphrase', question: 'Does the platform explain how recommendations work?', answer: 'A help article describes why certain videos are suggested to you and how to reset the suggestions.' },
]

/** Other passages: ordinary page text, and text on nearby topics that share words with the questions but do not answer them. */
const OTHER = [
  'Our company was founded in 2015 and now has offices in twelve cities.',
  'We are hiring engineers, designers and moderators. See open roles on the careers page.',
  'This site uses cookies to improve your experience. You can change your cookie choices at any time.',
  'Contact our press team for interviews, images and company news.',
  'Download the app for iPhone or Android from the store.',
  'Adult accounts are public by default and can be switched to private in settings.',
  'Business accounts can run personalised ads targeted by interest and location.',
  'Sign up with your email address and a password, then choose a username.',
  'We keep server logs for 90 days and then delete them for operational reasons.',
  'Spam reports are reviewed by our automation team within a week.',
  'Creators earn money from gifts and subscriptions paid by their followers.',
  'Turn on two-factor authentication to protect your account from strangers.',
  'If you forget your password, we can send a reset link to your email address.',
  'Post a video of up to ten minutes, add a caption and choose who can comment.',
  'Our community guidelines ask everyone to treat others with respect.',
  'You can follow other accounts and see their posts in your feed.',
  'Use the search box to find accounts, sounds and hashtags.',
  'Verified accounts show a blue badge next to the name.',
  'Premium members get an ad-free experience and extra storage.',
  'The platform is available in forty languages and supports screen readers.',
  'Advertisers can reach adults who are interested in sport, travel or music.',
  'Our data centres are located in three regions and are audited every year.',
  'Moderators review reports about copyright and trademark claims.',
  'Friends can see when you are online unless you switch off your activity status.',
  'Messages are sent instantly and can include photos, voice notes and stickers.',
  'Shop products directly from creators in the shopping tab.',
  'Collections let you save videos and share them with friends.',
  'Our transparency report is published twice a year.',
  'Earn badges by completing challenges and joining events.',
  'Comments can be filtered by keyword to hide words you do not want to see.',
  'Group chats can include up to two hundred people.',
  'You can change your username once every thirty days.',
  'Use stickers and filters to make your videos more fun.',
  'Our support team replies to most tickets within two working days.',
  'Terms of service were last updated in March.',
  'Partners can apply to use our developer tools.',
  'Notifications can be adjusted for likes, comments and new followers.',
  'The platform has been recognised for design and innovation.',
  'Share a video to other apps with a single tap.',
  'Download your favourite sounds and use them in new videos.',
]

const args = process.argv.slice(2)
const labelAt = args.indexOf('--label')
const LABEL = labelAt >= 0 ? args[labelAt + 1] : 'retrieval'

const STOP = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'will', 'with', 'do', 'does', 'can', 'you', 'your', 'who', 'their', 'them', 'they', 'not', 'off', 'than', 'then', 'any', 'all'])
function stem(word: string): string {
  let w = word
  for (const [suffix, replacement] of [['ies', 'y'], ['sses', 'ss'], ['ing', ''], ['ed', ''], ['es', ''], ['s', '']] as const) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length) + replacement
      break
    }
  }
  return w
}
const stems = (text: string): Set<string> => new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)).map(stem))

const out: string[] = []
const say = (line = ''): void => {
  console.log(line)
  out.push(line)
}
const pct = (n: number, d: number): string => `${((100 * n) / d).toFixed(0)}% (${n} of ${d})`

async function main(): Promise<void> {
  const embedder = createEmbedder()
  if (!embedder) throw new Error('No embedder is configured (set GEMINI_API_KEY).')
  const repo = createMemoryRepository()
  const run = await repo.createRun({ projectId: 'bench', startedBy: 'bench', scope: 'all' })

  // Pages of ~14 passages each; the answers are spread over the pages.
  const texts = [...CASES.map((c) => c.answer), ...OTHER]
  const order = texts.map((t, i) => ({ t, k: (i * 7919) % 1009 })).sort((a, b) => a.k - b.k).map((x) => x.t)
  const passageOf = new Map<string, Passage>()
  for (let at = 0; at < order.length; at += 14) {
    const page = await repo.addPage(run.id, { url: `https://bench.test/p${at}`, finalUrl: null, httpStatus: 200, accessStatus: 'ok', accessDetail: null, title: 'Page', text: '', accessibilitySnapshot: null, screenshotPath: null, contentHash: 'h' } as never)
    const made = await repo.addPassages(page.id, order.slice(at, at + 14).map((text, position) => ({ position, kind: 'text' as const, text })))
    made.forEach((p) => passageOf.set(p.text, p))
  }
  const all = [...passageOf.values()]

  // The same keyword search for both arms.
  repo.searchPassages = async (_runId, query, limit) => {
    const wanted = stems(query)
    return all
      .map((p) => ({ p, score: [...stems(p.text)].filter((w) => wanted.has(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.p.position - b.p.position)
      .slice(0, limit)
      .map((x) => x.p)
  }
  const ctx = { run: { ...run, capturedInRunId: run.id }, deps: { repo, embedder }, signal: new AbortController().signal } as unknown as RunCtx

  say(`# Page retrieval evaluation: ${LABEL}`)
  say()
  say(`- Date: ${new Date().toISOString()}`)
  say(`- Embedder: ${embedder.model}; passage similarity floor ${MIN_PASSAGE_SIMILARITY}; each search merges up to ${HYBRID_POOL} hits per method`)
  say(`- Test set: ${CASES.length} questions (${CASES.filter((c) => c.kind === 'lexical').length} lexical, ${CASES.filter((c) => c.kind === 'paraphrase').length} paraphrase), ${all.length} passages on ${Math.ceil(order.length / 14)} pages. The production run sends the top 5 passages of each item to the AI.`)
  say()

  const keywordRanks: (number | null)[] = []
  const hybridRanks: (number | null)[] = []
  const rows: string[] = []
  for (const c of CASES) {
    const answer = passageOf.get(c.answer) as Passage
    const keyword = await repo.searchPassages(run.id, c.question, 15)
    const hybrid = await searchForItem(ctx, c.question, 15)
    const rank = (list: Passage[]): number | null => {
      const at = list.findIndex((p) => p.id === answer.id)
      return at < 0 ? null : at + 1
    }
    keywordRanks.push(rank(keyword))
    hybridRanks.push(rank(hybrid))
    rows.push(`| ${c.kind} | ${c.question} | ${keywordRanks.at(-1) ?? 'not found'} | ${hybridRanks.at(-1) ?? 'not found'} |`)
  }

  const summary = (label: string, ranks: (number | null)[], pick: (i: number) => boolean): string => {
    const idx = ranks.map((_, i) => i).filter(pick)
    const within = (k: number): number => idx.filter((i) => (ranks[i] ?? Infinity) <= k).length
    const mrr = idx.reduce((sum, i) => sum + (ranks[i] ? 1 / (ranks[i] as number) : 0), 0) / idx.length
    return `| ${label} | ${pct(within(1), idx.length)} | ${pct(within(3), idx.length)} | ${pct(within(5), idx.length)} | ${mrr.toFixed(3)} |`
  }
  say('| Group | Method | Answer ranked 1st | In top 3 | In top 5 (what the AI sees) | Mean reciprocal rank |')
  say('| --- | --- | --- | --- | --- | --- |')
  for (const [group, pick] of [['all 16', () => true], ['lexical 6', (i: number) => CASES[i].kind === 'lexical'], ['paraphrase 10', (i: number) => CASES[i].kind === 'paraphrase']] as const) {
    say(summary(`${group} | keywords only`, keywordRanks, pick))
    say(summary(`${group} | keywords + meaning`, hybridRanks, pick))
  }
  say()
  say('Rank of the answering passage for each question (lower is better; "not found" means it was not in the top 15):')
  say()
  say('| Kind | Question | Keywords only | Keywords + meaning |')
  say('| --- | --- | --- | --- |')
  rows.forEach((r) => say(r))

  mkdirSync('../docs/testing/benchmarks', { recursive: true })
  writeFileSync(`../docs/testing/benchmarks/${new Date().toISOString().slice(0, 10)}-${LABEL}.md`, `${out.join('\n')}\n`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
