import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_NO_STEPS_REASON, judgeItem, liveHighlighter, selectStepPassages } from '../../../../src/features/evidence/appJudge.js'
import type { AppSession, AppSessionPool } from '../../../../src/features/evidence/appSession.js'
import { recordStep, type StepContext, type StepInput } from '../../../../src/features/evidence/appSteps.js'
import type { AgentAccount, AppAction, AppElement, AppStep, AppView, StoppedBy } from '../../../../src/features/evidence/appTypes.js'
import { buildPrompt, type AssessedItem, type AssessInput, type AssessItem, type AssessOutput } from '../../../../src/features/evidence/assess.js'
import { fakeAudit, PROJECT } from '../../../fixtures/runnerWorld.js'
import { createMemoryAppRepository } from '../../../../src/features/evidence/memoryAppRepository.js'
import { createMemoryRepository } from '../../../../src/features/evidence/memoryRepository.js'
import type { EvidenceRepository, ScreenshotStore } from '../../../../src/features/evidence/repository.js'
import { storeRound, type Highlighter, type TokenMeter } from '../../../../src/features/evidence/runnerAssess.js'
import { highlightKey } from '../../../../src/features/evidence/runnerHighlights.js'
import type { ResolvedDeps, RunCtx } from '../../../../src/features/evidence/runnerShared.js'
import { redactUrl } from '../../../../src/features/evidence/secrets.js'
import type { CapturedPage, Passage } from '../../../../src/features/evidence/types.js'

const ITEM: AssessItem = {
  id: 'i1',
  guidelineId: 'g1',
  category: 'Privacy',
  name: null,
  text: 'Are teen accounts private by default?',
  helpText: null,
}
const TEEN: AgentAccount = { id: 'acc-teen', label: 'Teen 15', ageGroup: 'under_18', age: 15, handles: ['@teen'] }
const ADULT: AgentAccount = { id: 'acc-adult', label: 'Adult 30', ageGroup: 'adult', age: 30, handles: ['@adult'] }
const HOME_TEXT = 'Welcome home. Your feed shows the newest posts first.'
const SETTINGS_TEXT = 'Your account is private. Only approved followers see your posts.'
const TYPED = 'Teen accounts are private'

function el(ref: string, role: string, name: string, extra: Partial<AppElement> = {}): AppElement {
  return { ref, role, name, tag: 'button', inputType: null, href: null, groupId: null, state: {}, contextText: '', ...extra }
}

function view(path: string, text: string, elements: AppElement[] = []): AppView {
  return { url: `http://app.test${path}`, title: 'App', text, elements, frameUrls: [], hasPasswordField: false }
}

const HOME = view('/home', HOME_TEXT, [el('e1', 'link', 'Settings', { tag: 'a', href: 'http://app.test/settings' })])
const SETTINGS = view('/settings', SETTINGS_TEXT, [el('e6', 'switch', 'Private account', { state: { checked: true } })])

type Answer = (input: AssessInput) => AssessOutput

function result(over: Partial<AssessedItem> = {}): AssessedItem {
  return {
    itemId: ITEM.id,
    suggestedResult: 'yes',
    reason: 'The settings page says the account is private.',
    quotes: [],
    evidenceSufficient: true,
    conflicting: false,
    webAssessable: true,
    confidence: 'high',
    ...over,
  }
}

/** Quotes `text`, naming the sent passage that `pick` finds. */
const quoting = (pick: (p: Passage) => boolean, text: string) => (input: AssessInput) => ({
  passageId: input.passages.find(pick)?.id ?? null,
  text,
})

function meterOf(start = 0): TokenMeter {
  let used = start
  return { used: () => used, add: (t) => (used += t) }
}

interface Kit {
  repo: EvidenceRepository & ScreenshotStore
  ctx: RunCtx
  stepCtx: StepContext
  calls: AssessInput[]
  browserProvider: ReturnType<typeof vi.fn>
  highlights: ReturnType<typeof vi.fn>
  answer: { current: Answer }
  steps: AppStep[]
  record(input: Partial<StepInput> & { action: AppAction }): Promise<AppStep>
}

async function createKit(): Promise<Kit> {
  const repo = createMemoryRepository()
  const appRepo = createMemoryAppRepository()
  const run = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all', source: 'app' })
  const calls: AssessInput[] = []
  const answer: Kit['answer'] = { current: () => ({ results: [result()], missingItemIds: [], tokensUsed: 70 }) }
  const browserProvider = vi.fn(async () => ({}) as never)
  const highlights = vi.fn(async () => new Map<string, Buffer>())
  const deps: ResolvedDeps = {
    repo,
    screenshots: repo,
    audit: fakeAudit([ITEM]),
    guard: { check: async () => ({ allowed: true }) },
    apiKey: 'gsk_test_secret_key',
    model: 'test-model',
    browserProvider,
    capture: async () => undefined,
    highlights,
    assessBatch: async (input) => {
      calls.push(input)
      return answer.current(input)
    },
    retryDelaysMs: [0, 0, 0],
    app: null,
    code: null,
  }
  const ctx: RunCtx = { run, deps, signal: new AbortController().signal, robots: null, browser: () => browserProvider() }
  const stepCtx: StepContext = { run, itemId: ITEM.id, repo, screenshots: repo, appRepo }
  const steps: AppStep[] = []
  return {
    repo,
    ctx,
    stepCtx,
    calls,
    browserProvider,
    highlights,
    answer,
    steps,
    async record(input) {
      const step = await recordStep(stepCtx, {
        position: steps.length + 1,
        account: TEEN,
        outcome: 'done',
        detail: '',
        refusalReason: null,
        view: null,
        screenshot: input.view ? Buffer.from('step-jpeg') : null,
        ...input,
      })
      steps.push(step)
      return step
    },
  }
}

/** Step 1 opens home, step 2 opens settings, step 3 is the AI's finish. */
async function recordDefault(kit: Kit): Promise<void> {
  await kit.record({ action: { type: 'open_link', url: '/home' }, detail: 'page /home opened', view: HOME })
  await kit.record({ action: { type: 'open_link', ref: 'e1' }, detail: 'page /settings opened', view: SETTINGS, describedOn: HOME })
  await kit.record({ action: { type: 'finish', observations: 'The account is private.', evidenceSteps: [2] } })
}

function judge(kit: Kit, over: { evidenceSteps?: number[]; stoppedBy?: StoppedBy | null; meter?: TokenMeter; highlighter?: Highlighter | null } = {}) {
  return judgeItem(kit.ctx, {
    item: ITEM,
    platform: 'TikTok',
    steps: kit.steps,
    evidenceSteps: over.evidenceSteps ?? [2],
    stoppedBy: over.stoppedBy ?? null,
    meter: over.meter ?? meterOf(),
    highlighter: over.highlighter === undefined ? null : over.highlighter,
  })
}

const isLine = (n: number) => (p: Passage) => p.position === 0 && p.text.startsWith(`Step ${n} `)

let logged: string[]
beforeEach(() => {
  logged = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  })
})
afterEach(() => vi.restoreAllMocks())

describe('judgeItem', () => {
  it('sends the step lines and the evidence steps’ pages with evidenceKind app', async () => {
    const kit = await createKit()
    await recordDefault(kit)

    await judge(kit)

    expect(kit.calls).toHaveLength(1)
    const call = kit.calls[0]
    expect(call.evidenceKind).toBe('app')
    expect(call.platform).toBe('TikTok')
    expect(call.items.map((i) => i.id)).toEqual([ITEM.id])
    const texts = call.passages.map((p) => p.text)
    expect(texts[0]).toBe('Step 1 · Teen 15 · opened /home → page /home opened')
    expect(texts[1]).toBe('Step 2 · Teen 15 · opened link "Settings" → page /settings opened')
    // The evidence step's page comes before the other page.
    const settingsAt = texts.findIndex((t) => t.includes('Only approved followers'))
    const homeAt = texts.findIndex((t) => t.includes('newest posts first'))
    expect(settingsAt).toBeGreaterThan(1)
    expect(homeAt).toBeGreaterThan(settingsAt)
    // No finish observation is ever a passage.
    expect(texts.some((t) => t.includes('The account is private.'))).toBe(false)
    expect(new Set(call.passages.map((p) => p.id)).size).toBe(call.passages.length)
  })

  it('a quote of a step line is verified; a made-up quote is unverified and flagged', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    kit.answer.current = (input) => ({
      results: [
        result({
          quotes: [quoting(isLine(2), 'opened link "Settings"')(input), quoting(isLine(2), 'Teen accounts are always private')(input)],
        }),
      ],
      missingItemIds: [],
      tokensUsed: 50,
    })

    const s = await judge(kit)

    expect(s?.quotes.map((q) => q.verified)).toEqual([true, false])
    expect(s?.quotes[0].pageId).toBe(kit.steps[1].pageId)
    expect(s?.flags.map((f) => f.type)).toContain('unverified_quote')
  })

  it('text the AI typed cannot be quoted as proof (ruling A20), while the stored line keeps it', async () => {
    const kit = await createKit()
    const composer = view('/messages', 'Messages', [el('e2', 'textbox', 'Message', { tag: 'textarea', state: { value: TYPED } })])
    await kit.record({ action: { type: 'type', ref: 'e2', text: TYPED }, detail: 'page unchanged', view: composer })
    kit.answer.current = (input) => ({
      results: [
        result({
          quotes: [quoting(isLine(1), TYPED)(input), quoting((p) => p.kind === 'controls', TYPED)(input)],
        }),
      ],
      missingItemIds: [],
      tokensUsed: 50,
    })

    const s = await judge(kit, { evidenceSteps: [1] })

    const sent = kit.calls[0].passages
    expect(sent[0].text).toBe('Step 1 · Teen 15 · typed text into textbox "Message" → page unchanged')
    // Only the step line is rewritten (ruling A20b): the controls passage is sent as the app showed it.
    expect(sent.find((p) => p.kind === 'controls')?.text).toContain(TYPED)
    expect(s?.suggestedResult).toBe('yes')
    expect(s?.quotes.every((q) => !q.verified)).toBe(true)
    expect(s?.flags.map((f) => f.type)).toContain('unverified_quote')
    // The stored step row and its passage stay as the check wrote them.
    expect(kit.steps[0].line).toContain(`typed "${TYPED}"`)
    const stored = await kit.repo.listPassagesOfPages([kit.steps[0].pageId as string])
    expect(stored[0].text).toContain(`typed "${TYPED}"`)
  })

  describe('quotes of what the AI wrote are unverified (ruling A20b)', () => {
    const LONG = `${TYPED} on this platform by default, and only approved followers can see the posts they share with them.`

    it('a typed text over 100 characters, quoted from its cut-short textbox value', async () => {
      expect(LONG.length).toBeGreaterThan(100)
      const kit = await createKit()
      const composer = view('/messages', 'Messages', [el('e2', 'textbox', 'Message', { tag: 'textarea', state: { value: LONG.slice(0, 100) } })])
      await kit.record({ action: { type: 'type', ref: 'e2', text: LONG }, detail: 'page unchanged', view: composer })
      const quote = `${TYPED} on this platform by default`
      kit.answer.current = (input) => ({ results: [result({ quotes: [quoting((p) => p.kind === 'controls', quote)(input)] })], missingItemIds: [], tokensUsed: 5 })

      const s = await judge(kit, { evidenceSteps: [1] })

      expect(kit.calls[0].passages.find((p) => p.kind === 'controls')?.text).toContain(quote)
      expect(s?.quotes[0].verified).toBe(false)
      expect(s?.flags.map((f) => f.type)).toContain('unverified_quote')
    })

    it('a made-up option in a refused select', async () => {
      const kit = await createKit()
      const audience = el('e5', 'combobox', 'Audience', { tag: 'select', state: { value: 'Public', options: ['Public', 'Friends'] } })
      const page = view('/settings', SETTINGS_TEXT, [audience])
      await kit.record({
        action: { type: 'select', ref: 'e5', option: 'Only teens can see this' },
        outcome: 'refused',
        refusalReason: 'That option is not on the page.',
        view: page,
      })
      kit.answer.current = (input) => ({
        results: [result({ quotes: [quoting(isLine(1), '"Only teens can see this"')(input)] })],
        missingItemIds: [],
        tokensUsed: 5,
      })

      const s = await judge(kit, { evidenceSteps: [1] })

      expect(kit.calls[0].passages[0].text).toContain('Only teens can see this')
      expect(s?.quotes[0].verified).toBe(false)
      expect(s?.flags.map((f) => f.type)).toContain('unverified_quote')
    })

    it('the option of a done select was offered by the app, so a quote of it verifies', async () => {
      const kit = await createKit()
      const audience = el('e5', 'combobox', 'Audience', { tag: 'select', state: { value: 'Only teens can see this' } })
      await kit.record({
        action: { type: 'select', ref: 'e5', option: 'Only teens can see this' },
        detail: 'page unchanged',
        view: view('/settings', SETTINGS_TEXT, [audience]),
      })
      kit.answer.current = (input) => ({
        results: [result({ quotes: [quoting((p) => p.kind === 'controls', 'Only teens can see this')(input)] })],
        missingItemIds: [],
        tokensUsed: 5,
      })

      const s = await judge(kit, { evidenceSteps: [1] })

      expect(s?.quotes[0].passageId).not.toBeNull()
      expect(s?.quotes[0].verified).toBe(true)
    })

    it('the option of a failed select is the AI\'s, wherever it is quoted from', async () => {
      const kit = await createKit()
      const audience = el('e5', 'combobox', 'Audience', { tag: 'select', state: { value: 'Public' } })
      await kit.record({
        action: { type: 'select', ref: 'e5', option: 'Only teens can see this' },
        outcome: 'failed',
        detail: 'That option could not be chosen.',
        view: view('/settings', 'Audience: Only teens can see this', [audience]),
      })
      kit.answer.current = (input) => ({
        results: [result({ quotes: [quoting((p) => p.position === 1, 'Only teens can see this')(input)] })],
        missingItemIds: [],
        tokensUsed: 5,
      })

      const s = await judge(kit, { evidenceSteps: [1] })

      expect(s?.quotes[0].passageId).not.toBeNull()
      expect(s?.quotes[0].verified).toBe(false)
    })

    describe('a quote that wraps what the AI typed (ruling A20c)', () => {
      const SHORT = 'Teen accounts are private by default'

      async function typedAndQuoted(typed: string, value: string | undefined, pageText: string, pick: (p: Passage) => boolean, quote: string) {
        const kit = await createKit()
        const composer = view('/messages', pageText, [el('e2', 'textbox', 'Message', { tag: 'textarea', state: value === undefined ? {} : { value } })])
        await kit.record({ action: { type: 'type', ref: 'e2', text: typed }, detail: 'page unchanged', view: composer })
        kit.answer.current = (input) => ({ results: [result({ quotes: [quoting(pick, quote)(input)] })], missingItemIds: [], tokensUsed: 5 })
        const s = await judge(kit, { evidenceSteps: [1] })
        expect(s?.quotes[0].passageId).not.toBeNull()
        return s?.quotes[0].verified
      }
      const controls = (p: Passage) => p.kind === 'controls'
      const pageText = (p: Passage) => p.position === 1

      it('the [value: …] wrapper of a typed text', async () => {
        expect(await typedAndQuoted(SHORT, SHORT, 'Messages', controls, `[value: ${SHORT}]`)).toBe(false)
        expect(await typedAndQuoted(SHORT, SHORT, 'Messages', controls, `textbox "Message" [value: ${SHORT}]`)).toBe(false)
      })

      it('the [value: …] wrapper of a typed text over 100 characters, cut short', async () => {
        const long = `${SHORT}, and only approved followers can see the posts that teen accounts share with them.`
        expect(long.length).toBeGreaterThan(100)
        expect(await typedAndQuoted(long, long.slice(0, 100), 'Messages', controls, `[value: ${SHORT}, and only approved followers`)).toBe(false)
      })

      it('a "Your post:" prefix the app puts on a typed text', async () => {
        expect(await typedAndQuoted(SHORT, undefined, `Your post: ${SHORT}`, pageText, `Your post: ${SHORT}`)).toBe(false)
      })

      it('a whole typed text of two words inside a longer quote', async () => {
        expect(await typedAndQuoted('Hello there', undefined, 'Message sent to Teen 16: Hello there', pageText, 'Message sent to Teen 16: Hello there')).toBe(false)
      })

      it('a page sentence sharing only 3 words with the typed text verifies', async () => {
        expect(await typedAndQuoted(SHORT, undefined, 'Teen accounts are shown a safety notice first.', pageText, 'Teen accounts are shown a safety notice first.')).toBe(true)
      })
    })

    it('the app showing the typed text in capitals', async () => {
      const kit = await createKit()
      const composer = view('/messages', `Draft\n${TYPED.toUpperCase()}`, [el('e2', 'textbox', 'Message', { tag: 'textarea' })])
      await kit.record({ action: { type: 'type', ref: 'e2', text: TYPED }, detail: 'page unchanged', view: composer })
      kit.answer.current = (input) => ({
        results: [result({ quotes: [quoting((p) => p.text.includes(TYPED.toUpperCase()), TYPED.toUpperCase())(input)] })],
        missingItemIds: [],
        tokensUsed: 5,
      })

      const s = await judge(kit, { evidenceSteps: [1] })

      expect(s?.quotes[0].passageId).not.toBeNull()
      expect(s?.quotes[0].verified).toBe(false)
    })

    it('typing "private" in search leaves "Your account is private." quotable, with the page passages sent as stored', async () => {
      const kit = await createKit()
      const page = view('/settings', `${SETTINGS_TEXT}\nStart a new post.`, [
        el('e3', 'searchbox', 'Search settings', { tag: 'input', inputType: 'search' }),
        el('e4', 'switch', 'Private account', { state: { checked: true } }),
      ])
      await kit.record({ action: { type: 'type', ref: 'e3', text: 'private' }, detail: 'page unchanged', view: page })
      kit.answer.current = (input) => ({
        results: [result({ quotes: [quoting((p) => p.text.includes('Your account'), 'Your account is private.')(input)] })],
        missingItemIds: [],
        tokensUsed: 5,
      })

      const s = await judge(kit, { evidenceSteps: [1] })

      expect(s?.quotes[0].verified).toBe(true)
      const stored = await kit.repo.listPassagesOfPages([kit.steps[0].pageId as string])
      const sent = new Map(kit.calls[0].passages.map((p) => [p.id, p.text]))
      for (const p of stored.filter((x) => x.position > 0)) expect(sent.get(p.id)).toBe(p.text)
      expect(stored.some((p) => p.position > 0 && p.text.includes('\n'))).toBe(true)
    })

    it('a quote of a Refused line supporting yes is unverified and flagged', async () => {
      const kit = await createKit()
      const page = view('/u/stranger', 'A stranger profile.', [el('e1', 'button', 'Message')])
      await kit.record({
        action: { type: 'click', ref: 'e1' },
        outcome: 'refused',
        refusalReason: 'Messaging an account that is not a test account is not allowed.',
        view: page,
      })
      kit.answer.current = (input) => ({
        results: [result({ quotes: [quoting(isLine(1), 'Refused: clicked button "Message"')(input)] })],
        missingItemIds: [],
        tokensUsed: 5,
      })

      const s = await judge(kit, { evidenceSteps: [1] })

      expect(s?.suggestedResult).toBe('yes')
      expect(s?.quotes[0].verified).toBe(false)
      expect(s?.flags.map((f) => f.type)).toContain('unverified_quote')
    })
  })

  it('a yes with no quote gets missing_evidence: a claim no step supports is flagged', async () => {
    const kit = await createKit()
    await recordDefault(kit)

    const s = await judge(kit)

    expect(s?.suggestedResult).toBe('yes')
    expect(s?.quotes).toEqual([])
    expect(s?.flags.map((f) => f.type)).toContain('missing_evidence')
  })

  it('a check stopped by a captcha gets an inaccessible flag even when the AI answered', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    const captcha = view('/challenge', 'Prove you are human before you go on.')
    await kit.record({
      action: { type: 'finish', observations: '', evidenceSteps: [] },
      outcome: 'blocked',
      detail: 'The app asked for a captcha.',
      view: captcha,
      blocked: true,
    })
    kit.answer.current = (input) => ({
      results: [result({ quotes: [quoting((p) => p.text.includes('Only approved'), 'Only approved followers see your posts.')(input)] })],
      missingItemIds: [],
      tokensUsed: 50,
    })
    const stoppedBy = { url: captcha.url, detail: 'The app asked for a captcha.' }

    const s = await judge(kit, { stoppedBy })

    expect(s?.quotes[0].verified).toBe(true)
    expect(s?.flags).toContainEqual({
      type: 'inaccessible',
      reason: 'The check stopped at http://app.test/challenge: The app asked for a captcha.',
    })
    // The blocked page keeps its passages.
    expect(kit.calls[0].passages.some((p) => p.text.includes('Prove you are human'))).toBe(true)
  })

  it('a check with no recorded page stores a null suggestion without calling the AI', async () => {
    const kit = await createKit()
    await kit.record({ action: { type: 'finish', observations: '', evidenceSteps: [] }, outcome: 'failed', detail: "The AI's reply could not be read." })
    const meter = meterOf()

    const s = await judge(kit, { evidenceSteps: [], meter })

    expect(kit.calls).toHaveLength(0)
    expect(meter.used()).toBe(0)
    expect(s?.suggestedResult).toBeNull()
    expect(s?.reason).toBe(APP_NO_STEPS_REASON)
    expect(APP_NO_STEPS_REASON).toBe('The check ended before any page of the app could be recorded.')
    expect(s?.source).toBe('app')
    expect(s?.flags.map((f) => f.type)).toContain('missing_evidence')

    const empty = await createKit()
    const t = await judge(empty, { evidenceSteps: [], stoppedBy: { url: 'http://app.test/login', detail: 'A 2-factor prompt.' } })
    expect(t?.reason).toBe(APP_NO_STEPS_REASON)
    expect(t?.flags.map((f) => f.type)).toContain('inaccessible')
  })

  it('stores the suggestion with source app and adds the tokens to the meter', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    const meter = meterOf(100)

    const s = await judge(kit, { meter })

    expect(meter.used()).toBe(170)
    expect(s?.source).toBe('app')
    const stored = await kit.repo.listSuggestions(kit.ctx.run.id)
    expect(stored).toHaveLength(1)
    expect(stored[0].source).toBe('app')
    expect(stored[0].passageIdsSent).toEqual(kit.calls[0].passages.map((p) => p.id))
  })

  it('returns null when the AI left the item out, and throws a Groq limit on', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    kit.answer.current = () => ({ results: [], missingItemIds: [ITEM.id], tokensUsed: 30 })
    const meter = meterOf()

    await expect(judge(kit, { meter })).resolves.toBeNull()
    expect(meter.used()).toBe(30)
    expect(await kit.repo.listSuggestions(kit.ctx.run.id)).toEqual([])

    kit.answer.current = () => {
      throw new Error('Groq request failed with status 429')
    }
    await expect(judge(kit)).rejects.toThrow(/429/)
  })

  it('uses the highlighter for verified page-text quotes; null means the full step screenshot', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    const pageQuote = 'Only approved followers see your posts.'
    const lineQuote = 'opened link "Settings"'
    kit.answer.current = (input) => ({
      results: [
        result({
          quotes: [
            quoting((p) => p.text.includes('Only approved'), pageQuote)(input),
            quoting(isLine(2), lineQuote)(input),
            quoting((p) => p.kind === 'controls', 'switch "Private account" [on]')(input),
          ],
        }),
      ],
      missingItemIds: [],
      tokensUsed: 50,
    })
    const settingsPage = kit.steps[1].pageId as string
    const highlighter = vi.fn<Highlighter>(async () => new Map([[highlightKey(settingsPage, pageQuote), 'proj-1/run/highlight-x.jpg']]))

    const s = await judge(kit, { highlighter })

    expect(highlighter).toHaveBeenCalledTimes(1)
    const asked = highlighter.mock.calls[0][0]
    expect(asked.get(settingsPage)).toEqual([pageQuote])
    // A step line is not page text: it never goes to the highlighter.
    expect([...asked.values()].flat()).not.toContain(lineQuote)
    expect(s?.quotes.map((q) => q.verified)).toEqual([true, true, true])
    expect(s?.quotes[0].highlightScreenshotPath).toBe('proj-1/run/highlight-x.jpg')
    expect(s?.quotes[1].highlightScreenshotPath).toBeNull()
    expect(s?.quotes[2].highlightScreenshotPath).toBeNull()

    const plain = await createKit()
    await recordDefault(plain)
    plain.answer.current = kit.answer.current
    const t = await judge(plain, { highlighter: null })
    expect(t?.quotes[0].verified).toBe(true)
    expect(t?.quotes[0].highlightScreenshotPath).toBeNull()
    // The card falls back to the step's full screenshot.
    const page = await plain.repo.getPage(t?.quotes[0].pageId as string)
    expect(page?.screenshotPath).toMatch(/step-/)
    expect(plain.browserProvider).not.toHaveBeenCalled()
  })
})

describe('judgeItem: which account saw each page', () => {
  const ADULT_SETTINGS = view('/settings', 'Private account Off. Anyone can follow you.', [el('e6', 'switch', 'Private account', { state: { checked: false } })])

  /** Teen 15 opens home (step 1); Adult 30 opens its settings (step 2); the finish names step 2. */
  async function recordTwoAccounts(kit: Kit): Promise<void> {
    await kit.record({ action: { type: 'open_link', url: '/home' }, detail: 'page /home opened', view: HOME })
    await kit.record({ action: { type: 'open_link', url: '/settings' }, detail: 'page /settings opened', view: ADULT_SETTINGS, account: ADULT })
    await kit.record({ action: { type: 'finish', observations: 'Seen.', evidenceSteps: [2] } })
  }

  it('each sent passage carries the account and step of the page it came from, and the prompt shows them', async () => {
    const kit = await createKit()
    await recordTwoAccounts(kit)
    await judge(kit)
    const call = kit.calls[0]
    const sources = call.passageSources ?? new Map()
    for (const p of call.passages) {
      const step = kit.steps.find((s) => s.pageId === p.pageId)!
      expect(sources.get(p.id)).toEqual({ account: step.accountLabel, step: step.position })
    }
    const adultPage = call.passages.find((p) => p.text.includes('Anyone can follow you'))!
    expect(sources.get(adultPage.id)).toEqual({ account: 'Adult 30', step: 2 })
    // The stored passage text is unchanged: no account is written into it.
    expect(adultPage.text).not.toContain('Adult 30')
    const { user } = buildPrompt(call.items, call.passages, call.platform, 'app', call.passageSources)
    const sent = JSON.parse(user.slice(user.indexOf('{'))).passages as { account?: string; step?: number; text: string }[]
    expect(sent.find((p) => p.text.includes('Anyone can follow you'))).toMatchObject({ account: 'Adult 30', step: 2 })
    expect(sent.find((p) => p.text.includes('newest posts first'))).toMatchObject({ account: 'Teen 15', step: 1 })
  })

  it('a quote of a page passage still verifies against the stored text', async () => {
    const kit = await createKit()
    await recordTwoAccounts(kit)
    kit.answer.current = (input) => ({
      results: [result({ suggestedResult: 'no', quotes: [quoting((p) => p.text.includes('Anyone can follow you'), 'Anyone can follow you')(input)] })],
      missingItemIds: [],
      tokensUsed: 50,
    })
    const s = await judge(kit)
    expect(s?.quotes.map((q) => q.verified)).toEqual([true])
    expect(s?.quotes[0].pageId).toBe(kit.steps[1].pageId)
  })
})

describe('selectStepPassages', () => {
  const p = (id: string, chars: number, position = 1): Passage => ({ id, pageId: `pg-${id}`, position, kind: 'text', text: 'x'.repeat(chars) })

  it('selectStepPassages keeps the newest step lines within half the budget, dropping the oldest, and never sends a step line twice', () => {
    const lines = [p('s1', 100, 0), p('s2', 100, 0), p('s3', 100, 0), p('s4', 100, 0)]
    const pages = [[lines[3], p('a1', 100), p('a2', 100)], [lines[2], p('b1', 100)]]

    const picked = selectStepPassages(lines, pages, 120).map((x) => x.id)

    expect(picked).toEqual(['s3', 's4', 'a1', 'b1'])
  })

  it('goes round-robin over the pages and skips a passage that does not fit', () => {
    const pages = [[p('a1', 40), p('a2', 400), p('a3', 40)], [p('b1', 40), p('b2', 40)]]
    expect(selectStepPassages([], pages, 60).map((x) => x.id)).toEqual(['a1', 'b1', 'b2', 'a3'])
  })
})

describe('storeRound', () => {
  it('storeRound with a null highlighter takes no close-ups and never calls browserProvider', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    const [passage] = (await kit.repo.listPassagesOfPages([kit.steps[1].pageId as string])).filter((x) => x.position === 1)
    const page = (await kit.repo.getPage(passage.pageId)) as CapturedPage

    const created = await storeRound(
      kit.ctx,
      {
        selected: [passage],
        found: new Map([[ITEM.id, 1]]),
        results: [result({ quotes: [{ passageId: passage.id, text: 'Only approved followers see your posts.' }] })],
      },
      { platform: 'TikTok', pages: new Map([[page.id, page]]), failedPages: [] },
      null,
    )

    expect(created).toHaveLength(1)
    expect(created[0].quotes[0].verified).toBe(true)
    expect(created[0].quotes[0].highlightScreenshotPath).toBeNull()
    expect(created[0].source).toBe('pages')
    expect(kit.browserProvider).not.toHaveBeenCalled()
    expect(kit.highlights).not.toHaveBeenCalled()
  })
})

describe('liveHighlighter', () => {
  function fakeSession(url: () => string, rawUrl = url): AppSession & { photographQuote: ReturnType<typeof vi.fn> } {
    return {
      currentUrl: url,
      page: { url: rawUrl } as never,
      photographQuote: vi.fn(async () => Buffer.from('close-up')),
    } as unknown as AppSession & { photographQuote: ReturnType<typeof vi.fn> }
  }
  function poolOf(sessions: Record<string, AppSession>): AppSessionPool {
    return { get: (id: string) => sessions[id] ?? null } as unknown as AppSessionPool
  }
  async function pagesOf(kit: Kit): Promise<Map<string, CapturedPage>> {
    const pages = new Map<string, CapturedPage>()
    for (const step of kit.steps) {
      if (step.pageId === null) continue
      pages.set(step.pageId, (await kit.repo.getPage(step.pageId)) as CapturedPage)
    }
    return pages
  }

  it('liveHighlighter skips a quote whose session has moved on to another page', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    const session = fakeSession(() => SETTINGS.url)
    const highlighter = liveHighlighter(kit.ctx, poolOf({ [TEEN.id]: session }), kit.steps, await pagesOf(kit))
    const home = kit.steps[0].pageId as string
    const settings = kit.steps[1].pageId as string

    const paths = await highlighter(new Map([
      [home, ['Your feed shows the newest posts first.']],
      [settings, ['Only approved followers see your posts.']],
    ]))

    expect(session.photographQuote).toHaveBeenCalledTimes(1)
    expect(session.photographQuote).toHaveBeenCalledWith('Only approved followers see your posts.')
    expect([...paths.keys()]).toEqual([highlightKey(settings, 'Only approved followers see your posts.')])
    const path = paths.get(highlightKey(settings, 'Only approved followers see your posts.')) as string
    expect(path).toMatch(new RegExp(`^${PROJECT}/${kit.ctx.run.id}/highlight-[0-9a-f-]{36}\\.jpg$`))
    await expect(kit.repo.signedUrl(path, 60)).resolves.toContain(path)
    expect(kit.browserProvider).not.toHaveBeenCalled()
  })

  it('liveHighlighter matches a page whose URL had a token, by its redacted form', async () => {
    const kit = await createKit()
    const raw = 'http://app.test/feed?token=abc123secret'
    const shown = redactUrl(raw)
    expect(shown).not.toBe(raw)
    await kit.record({ action: { type: 'open_link', url: '/feed' }, detail: 'page /feed opened', view: { ...view('/feed', HOME_TEXT), url: shown } })
    const session = fakeSession(() => shown, () => raw)
    const highlighter = liveHighlighter(kit.ctx, poolOf({ [TEEN.id]: session }), kit.steps, await pagesOf(kit))
    const pageId = kit.steps[0].pageId as string

    const paths = await highlighter(new Map([[pageId, ['Your feed shows the newest posts first.']]]))

    expect(paths.has(highlightKey(pageId, 'Your feed shows the newest posts first.'))).toBe(true)
  })

  it('photographs only the newest step page of the account, even when an older step was on the same address', async () => {
    const kit = await createKit()
    await kit.record({ action: { type: 'open_link', url: '/settings' }, detail: 'page /settings opened', view: SETTINGS })
    await kit.record({ action: { type: 'toggle', ref: 'e6' }, detail: 'page unchanged', view: SETTINGS })
    const session = fakeSession(() => SETTINGS.url)
    const [older, newer] = [kit.steps[0].pageId as string, kit.steps[1].pageId as string]
    const quote = 'Only approved followers see your posts.'

    const paths = await liveHighlighter(kit.ctx, poolOf({ [TEEN.id]: session }), kit.steps, await pagesOf(kit))(
      new Map([
        [older, [quote]],
        [newer, [quote]],
      ]),
    )

    expect([...paths.keys()]).toEqual([highlightKey(newer, quote)])
    expect(session.photographQuote).toHaveBeenCalledTimes(1)
  })

  it('leaves out a quote it cannot photograph, and a page whose account has no session', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    const session = fakeSession(() => SETTINGS.url)
    session.photographQuote.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('boom'))
    const settings = kit.steps[1].pageId as string

    const paths = await liveHighlighter(kit.ctx, poolOf({ [TEEN.id]: session }), kit.steps, await pagesOf(kit))(
      new Map([[settings, ['Only approved followers see your posts.', 'Your account is private.']]]),
    )
    expect(paths.size).toBe(0)

    const none = await liveHighlighter(kit.ctx, poolOf({}), kit.steps, await pagesOf(kit))(
      new Map([[settings, ['Only approved followers see your posts.']]]),
    )
    expect(none.size).toBe(0)
  })
})

describe('judgeItem and items about a default', () => {
  const DEFAULT_REASON =
    "This item is about a default setting, but the check only saw this account's current setting. Confirm the default yourself, for example with a newly created account."
  const quotedSettings = (input: AssessInput) => ({
    results: [result({ quotes: [quoting((p) => p.text.includes('Only approved'), 'Only approved followers see your posts.')(input)] })],
    missingItemIds: [],
    tokensUsed: 50,
  })
  const judgeOf = (kit: Kit, item: AssessItem) =>
    judgeItem(kit.ctx, { item, platform: 'TikTok', steps: kit.steps, evidenceSteps: [2], stoppedBy: null, meter: meterOf(), highlighter: null })

  it('a Yes on a "by default" item is stored with the default_unverified flag', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    kit.answer.current = quotedSettings

    const s = await judge(kit)

    expect(s?.suggestedResult).toBe('yes')
    expect(s?.flags).toContainEqual({ type: 'default_unverified', reason: DEFAULT_REASON })
    const [stored] = await kit.repo.listSuggestions(kit.ctx.run.id)
    expect(stored.flags.map((f) => f.type)).toContain('default_unverified')
  })

  it('reads the item name too', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    kit.answer.current = quotedSettings

    const s = await judgeOf(kit, { ...ITEM, name: 'Private by default', text: 'Are teen accounts private?' })

    expect(s?.flags.map((f) => f.type)).toContain('default_unverified')
  })

  it('no flag for an item that is not about a default, or for a null result', async () => {
    const kit = await createKit()
    await recordDefault(kit)
    kit.answer.current = quotedSettings
    const plain = await judgeOf(kit, { ...ITEM, text: 'Are teen accounts private?' })
    expect(plain?.flags).toEqual([])

    const other = await createKit()
    await recordDefault(other)
    other.answer.current = () => ({ results: [result({ suggestedResult: null })], missingItemIds: [], tokensUsed: 50 })
    const none = await judge(other)
    expect(none?.flags.map((f) => f.type)).not.toContain('default_unverified')
  })
})

describe('judgeItem: the second check of a claim', () => {
  const quoted = (input: AssessInput) => ({
    results: [result({ quotes: [quoting((p) => p.text.includes('private'), 'Your account is private.')(input)] })],
    missingItemIds: [],
    tokensUsed: 70,
  })

  async function judgeWith(verify: ((i: { claim: string }) => Promise<{ supported: boolean; tokensUsed: number }>) | null) {
    const kit = await createKit()
    await recordDefault(kit)
    kit.answer.current = quoted
    kit.ctx.deps.app = { appRepo: createMemoryAppRepository(), secretKey: null, verifyClaim: verify as never }
    const meter = meterOf()
    const stored = await judgeItem(kit.ctx, { item: ITEM, platform: 'Social', steps: kit.steps, evidenceSteps: [2], stoppedBy: null, meter, highlighter: null })
    return { stored, meter }
  }

  it('keeps a claim the second check supports, and counts its tokens', async () => {
    const verify = vi.fn(async () => ({ supported: true, tokensUsed: 30 }))
    const { stored, meter } = await judgeWith(verify)
    expect(stored?.suggestedResult).toBe('yes')
    expect(verify).toHaveBeenCalledTimes(1)
    expect(meter.used()).toBe(100)
  })

  it('withdraws a claim the second check does not confirm', async () => {
    const { stored } = await judgeWith(async () => ({ supported: false, tokensUsed: 10 }))
    expect(stored?.suggestedResult).toBeNull()
    expect(stored?.reason).toMatch(/second check did not confirm/i)
    expect(stored?.confidence).toBe('low')
  })

  it('keeps the first answer when the second check fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { stored } = await judgeWith(async () => {
      throw new Error('network down')
    })
    expect(stored?.suggestedResult).toBe('yes')
  })

  it('does nothing when no second check is set up', async () => {
    const { stored, meter } = await judgeWith(null)
    expect(stored?.suggestedResult).toBe('yes')
    expect(meter.used()).toBe(70)
  })

  it('does not check a partially answer or a claim with no quote', async () => {
    const verify = vi.fn(async () => ({ supported: false, tokensUsed: 1 }))
    const kit = await createKit()
    await recordDefault(kit)
    kit.answer.current = () => ({ results: [result({ suggestedResult: 'partially' })], missingItemIds: [], tokensUsed: 70 })
    kit.ctx.deps.app = { appRepo: createMemoryAppRepository(), secretKey: null, verifyClaim: verify }
    const stored = await judgeItem(kit.ctx, { item: ITEM, platform: 'Social', steps: kit.steps, evidenceSteps: [2], stoppedBy: null, meter: meterOf(), highlighter: null })
    expect(verify).not.toHaveBeenCalled()
    expect(stored?.suggestedResult).toBe('partially')
  })
})
