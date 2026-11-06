import { afterEach, describe, expect, it, vi } from 'vitest'
import { appPassagesOf, describeAction, detectChange, isAiFinish, locateControl, recordStep, restoreAddress, stepLine, type StepContext } from './appSteps.js'
import type { AgentAccount, AppAction, AppElement, AppStep, AppView } from './appTypes.js'
import { createMemoryAppRepository } from './memoryAppRepository.js'
import { createMemoryRepository } from './memoryRepository.js'

function el(ref: string, role: string, name: string, extra: Partial<AppElement> = {}): AppElement {
  return { ref, role, name, tag: 'button', inputType: null, href: null, groupId: null, state: {}, contextText: '', ...extra }
}

function view(elements: AppElement[], extra: Partial<AppView> = {}): AppView {
  return { url: 'http://app.test/settings', title: 'Settings', text: 'Settings', elements, frameUrls: [], hasPasswordField: false, ...extra }
}

const PAGE = view([
  el('e1', 'button', 'Message'),
  el('e2', 'textbox', 'Message', { tag: 'textarea' }),
  el('e3', 'textbox', 'Password', { tag: 'input', inputType: 'password' }),
  el('e4', 'link', 'Settings', { tag: 'a', href: 'http://app.test/settings' }),
  el('e5', 'combobox', 'Audience', { tag: 'select', state: { value: 'Public', options: ['Public', 'Only me'] } }),
  el('e6', 'switch', 'Private account', { state: { checked: false } }),
  el('e7', 'textbox', 'Username', { tag: 'input', inputType: 'text' }),
])

const describeCases: [AppAction, string][] = [
  [{ type: 'click', ref: 'e1' }, 'clicked button "Message"'],
  [{ type: 'type', ref: 'e2', text: 'hello' }, 'typed "hello" into textbox "Message"'],
  [{ type: 'fill_credential', ref: 'e3', account: 'Teen 15', field: 'password' }, 'filled the password of Teen 15 into "Password"'],
  [{ type: 'fill_credential', ref: 'e7', account: 'Teen 15', field: 'login' }, 'filled the login of Teen 15 into "Username"'],
  [{ type: 'open_link', ref: 'e4' }, 'opened link "Settings"'],
  [{ type: 'open_link', url: '/settings' }, 'opened /settings'],
  [{ type: 'open_link', url: 'http://app.test/settings?tab=privacy' }, 'opened /settings'],
  [{ type: 'select', ref: 'e5', option: 'Only me' }, 'selected "Only me" in "Audience"'],
  [{ type: 'toggle', ref: 'e6' }, 'toggled switch "Private account"'],
  [{ type: 'back' }, 'went back'],
  [{ type: 'switch_account', account: 'Adult 30' }, 'switched to Adult 30'],
  [{ type: 'finish', observations: 'It is private.', evidenceSteps: [1] }, 'finished the check'],
]

describe('describeAction', () => {
  it.each(describeCases)('describes %j as %s', (action, expected) => {
    expect(describeAction(action, PAGE)).toBe(expected)
  })

  it('names the element by its ref when there is no page', () => {
    expect(describeAction({ type: 'click', ref: 'e1' }, null)).toBe('clicked element e1')
  })
})

describe('stepLine', () => {
  it('writes each outcome with the exact copy', () => {
    expect(stepLine(4, 'Adult 30', 'clicked button "Message"', 'done', 'page /messages/new opened')).toBe(
      'Step 4 · Adult 30 · clicked button "Message" → page /messages/new opened',
    )
    expect(stepLine(5, 'Adult 30', 'clicked button "Follow"', 'refused', 'Not a test account.')).toBe(
      'Step 5 · Adult 30 · Refused: clicked button "Follow". Not a test account.',
    )
    expect(stepLine(6, 'Teen 15', 'clicked button "Save"', 'failed', 'The page changed before the action, so nothing was done.')).toBe(
      'Step 6 · Teen 15 · Failed: clicked button "Save". The page changed before the action, so nothing was done.',
    )
    expect(stepLine(2, 'Teen 15', 'clicked button "Sign in"', 'blocked', 'The page asks for a captcha.')).toBe(
      'Step 2 · Teen 15 · Stopped: The page asks for a captcha.',
    )
  })

  it('leaves the account out before any account is in use', () => {
    expect(stepLine(1, null, 'went back', 'refused', 'No test account is in use yet; choose one first.')).toBe(
      'Step 1 · Refused: went back. No test account is in use yet; choose one first.',
    )
  })

  it('a fill step line never contains a login name or password', () => {
    // A field that shows what it holds, and context text that quotes it, must not leak into the line.
    const leaky = view([
      el('e1', 'textbox', 'Username', { tag: 'input', inputType: 'text', state: { value: 'teen.login@example.test' }, contextText: 'Teen-Pass-111' }),
      el('e2', 'textbox', 'Password', { tag: 'input', inputType: 'password', contextText: 'teen.login@example.test Teen-Pass-111' }),
    ])
    const lines = (['login', 'password'] as const).map((field, i) =>
      stepLine(i + 1, 'Teen 15', describeAction({ type: 'fill_credential', ref: `e${i + 1}`, account: 'Teen 15', field }, leaky), 'done', 'page unchanged'),
    )
    for (const line of lines) {
      expect(line).not.toContain('teen.login@example.test')
      expect(line).not.toContain('Teen-Pass-111')
    }
    expect(lines[1]).toBe('Step 2 · Teen 15 · filled the password of Teen 15 into "Password" → page unchanged')
  })
})

describe('appPassagesOf', () => {
  it('appPassagesOf puts the step line first, then page text, then the controls list', () => {
    const page = view([el('e6', 'switch', 'Private account', { state: { checked: false } })], { text: 'First part.\n\nSecond part.' })
    const passages = appPassagesOf('Step 3 · Teen 15 · opened /settings → page /settings opened', page)
    expect(passages).toEqual([
      { position: 0, kind: 'text', text: 'Step 3 · Teen 15 · opened /settings → page /settings opened' },
      { position: 1, kind: 'text', text: 'First part.' },
      { position: 2, kind: 'text', text: 'Second part.' },
      { position: 3, kind: 'controls', text: 'e6 switch "Private account" [off]' },
    ])
  })
})

describe('detectChange', () => {
  const settings = (checked: boolean, extra: Partial<AppView> = {}) =>
    view([el('e1', 'switch', 'Private account', { state: { checked } }), el('e2', 'link', 'Home', { tag: 'a', href: 'http://app.test/home' })], extra)

  it('detectChange reports "Private account" off → on, and nothing for a plain link click', () => {
    expect(detectChange({ type: 'toggle', ref: 'e1' }, settings(false), settings(true))).toEqual({
      role: 'switch',
      control: 'Private account',
      before: 'off',
      after: 'on',
    })
    expect(detectChange({ type: 'click', ref: 'e2' }, settings(false), settings(false))).toBeNull()
  })

  it('reports a new selected value, and nothing when the page path changed or the state did not', () => {
    const audience = (value: string) => view([el('e5', 'combobox', 'Audience', { tag: 'select', state: { value } })])
    expect(detectChange({ type: 'select', ref: 'e5', option: 'Only me' }, audience('Public'), audience('Only me'))).toEqual({
      role: 'combobox',
      control: 'Audience',
      before: 'Public',
      after: 'Only me',
    })
    expect(detectChange({ type: 'toggle', ref: 'e1' }, settings(false), settings(true, { url: 'http://app.test/home' }))).toBeNull()
    expect(detectChange({ type: 'toggle', ref: 'e1' }, settings(false), settings(false))).toBeNull()
  })
})

describe('recordStep', () => {
  const run = { id: 'run-1', projectId: 'project-1' }
  const teen: AgentAccount = { id: 'acc-teen', label: 'Teen 15', ageGroup: 'under_18', age: 15, handles: ['teen15'] }

  function context(over: Partial<StepContext> = {}): StepContext & { repo: ReturnType<typeof createMemoryRepository> } {
    const repo = createMemoryRepository()
    return { run, itemId: 'item-1', repo, screenshots: repo, appRepo: createMemoryAppRepository(), ...over } as StepContext & {
      repo: ReturnType<typeof createMemoryRepository>
    }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores the page, its passages and the screenshot, then the step', async () => {
    const ctx = context()
    const upload = vi.spyOn(ctx.repo, 'upload')
    const step = await recordStep(ctx, {
      position: 1,
      account: teen,
      action: { type: 'toggle', ref: 'e6' },
      outcome: 'done',
      detail: '"Private account" is now on',
      refusalReason: null,
      view: PAGE,
      screenshot: Buffer.from('jpeg'),
    })
    expect(step).toMatchObject({ position: 1, accountId: 'acc-teen', accountLabel: 'Teen 15', outcome: 'done', runId: 'run-1', itemId: 'item-1' })
    expect(step.line).toBe('Step 1 · Teen 15 · toggled switch "Private account" → "Private account" is now on')
    const [page] = await ctx.repo.listPages(run.id)
    expect(step.pageId).toBe(page.id)
    expect(page).toMatchObject({ accessStatus: 'ok', url: PAGE.url, title: 'Settings', text: 'Settings' })
    expect(page.accessibilitySnapshot).toContain('e6 switch "Private account" [off]')
    expect(page.screenshotPath).toMatch(/^project-1\/run-1\/step-[0-9a-f-]{36}\.jpg$/)
    expect(upload).toHaveBeenCalledWith(page.screenshotPath, Buffer.from('jpeg'))
    const passages = await ctx.repo.listPassagesOfPages([page.id])
    expect(passages[0]).toMatchObject({ position: 0, kind: 'text', text: step.line })
    expect(await ctx.appRepo.listSteps(run.id)).toEqual([step])
  })

  it('a failed upload keeps the step without a screenshot', async () => {
    const ctx = context()
    vi.spyOn(ctx.repo, 'upload').mockRejectedValue(new Error('storage down'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const step = await recordStep(ctx, {
      position: 2,
      account: teen,
      action: { type: 'back' },
      outcome: 'done',
      detail: 'page /home opened',
      refusalReason: null,
      view: PAGE,
      screenshot: Buffer.from('jpeg'),
    })
    const [page] = await ctx.repo.listPages(run.id)
    expect(step.pageId).toBe(page.id)
    expect(page.screenshotPath).toBeNull()
  })

  it('a blocked step stores its page as blocked', async () => {
    const ctx = context()
    await recordStep(ctx, {
      position: 3,
      account: teen,
      action: { type: 'finish', observations: '', evidenceSteps: [] },
      outcome: 'blocked',
      detail: 'The page asks for a captcha.',
      refusalReason: null,
      view: PAGE,
      screenshot: null,
      blocked: true,
    })
    const [page] = await ctx.repo.listPages(run.id)
    expect(page).toMatchObject({ accessStatus: 'blocked', screenshotPath: null })
  })

  it('with no page, stores only the step row, and the observations stay in the action', async () => {
    const ctx = context()
    const step = await recordStep(ctx, {
      position: 1,
      account: null,
      action: { type: 'finish', observations: 'NOTE-FROM-AI', evidenceSteps: [] },
      outcome: 'done',
      detail: '',
      refusalReason: null,
      view: null,
      screenshot: null,
    })
    expect(step).toMatchObject({ pageId: null, accountId: null, accountLabel: null, line: 'Step 1 · finished the check' })
    expect(await ctx.repo.listPages(run.id)).toEqual([])
  })

  it('a refused step line carries the reason', async () => {
    const ctx = context()
    const step = await recordStep(ctx, {
      position: 1,
      account: teen,
      action: { type: 'click', ref: 'e1' },
      outcome: 'refused',
      detail: '',
      refusalReason: 'Not a test account.',
      view: PAGE,
      screenshot: null,
    })
    expect(step).toMatchObject({ outcome: 'refused', refusalReason: 'Not a test account.' })
    expect(step.line).toBe('Step 1 · Teen 15 · Refused: clicked button "Message". Not a test account.')
  })
})

describe('detectChange: radios and same-named controls (fix round 1)', () => {
  const radios = (publicOn: boolean) =>
    view([
      el('e1', 'radio', 'Public', { tag: 'input', inputType: 'radio', groupId: 'g1', state: { checked: publicOn } }),
      el('e2', 'radio', 'Only me', { tag: 'input', inputType: 'radio', groupId: 'g1', state: { checked: !publicOn } }),
      el('e3', 'radio', 'Friends', { tag: 'input', inputType: 'radio', groupId: 'g2', state: { checked: true } }),
    ])

  it('records the radio that was on before, with the newly chosen one', () => {
    expect(detectChange({ type: 'click', ref: 'e2' }, radios(true), radios(false))).toEqual({
      role: 'radio',
      control: 'Public',
      before: 'on',
      after: 'off',
      chosen: 'Only me',
    })
    expect(detectChange({ type: 'click', ref: 'e2' }, radios(false), radios(false))).toBeNull()
  })

  const twoSwitches = (first: boolean, second: boolean) =>
    view([
      el('e1', 'switch', 'Notifications', { state: { checked: first } }),
      el('e2', 'switch', 'Notifications', { state: { checked: second } }),
    ])

  it('keys a control by its place among controls with the same role and name', () => {
    expect(detectChange({ type: 'toggle', ref: 'e2' }, twoSwitches(true, true), twoSwitches(true, false))).toEqual({
      role: 'switch',
      control: 'Notifications (2)',
      before: 'on',
      after: 'off',
    })
    expect(detectChange({ type: 'toggle', ref: 'e1' }, twoSwitches(true, true), twoSwitches(false, true))).toMatchObject({ control: 'Notifications (1)' })
    // The count changed between the reads: which one is which cannot be told.
    const one = view([el('e1', 'switch', 'Notifications', { state: { checked: false } })])
    expect(detectChange({ type: 'toggle', ref: 'e2' }, twoSwitches(true, true), one)).toBeNull()
  })

  it('locateControl finds the nth same-named control, and a plain name as it is', () => {
    expect(locateControl(twoSwitches(true, false), 'switch', 'Notifications (2)')?.ref).toBe('e2')
    expect(locateControl(twoSwitches(true, false), 'switch', 'Notifications (3)')).toBeNull()
    expect(locateControl(PAGE, 'switch', 'Private account')?.ref).toBe('e6')
    const literal = view([el('e9', 'switch', 'Mode (2)', { state: { checked: true } })])
    expect(locateControl(literal, 'switch', 'Mode (2)')?.ref).toBe('e9')
  })
})

describe('restoreAddress', () => {
  it('keeps origin, path and the parameters that were not hidden, and drops the hash', () => {
    expect(restoreAddress('http://app.test/settings?token=redacted&tab=privacy#top')).toBe('http://app.test/settings?tab=privacy')
    expect(restoreAddress('http://app.test/settings?u=%5Bsecret%5D')).toBe('http://app.test/settings')
    expect(restoreAddress('http://app.test/settings')).toBe('http://app.test/settings')
  })
})

describe('isAiFinish', () => {
  const step = (action: AppAction, outcome: AppStep['outcome']): AppStep => ({
    id: 's',
    runId: 'r',
    itemId: 'i',
    position: 1,
    accountId: null,
    accountLabel: null,
    action,
    line: '',
    outcome,
    refusalReason: null,
    pageId: null,
    createdAt: '',
  })
  it('is true only for a finish the AI chose', () => {
    const finish: AppAction = { type: 'finish', observations: '', evidenceSteps: [] }
    expect(isAiFinish(step(finish, 'done'))).toBe(true)
    expect(isAiFinish(step(finish, 'blocked'))).toBe(false)
    expect(isAiFinish(step(finish, 'failed'))).toBe(false)
    expect(isAiFinish(step({ type: 'back' }, 'done'))).toBe(false)
  })
})
