/** Types for app evidence: the AI uses the platform's web app with test accounts. */

export type AgeGroup = 'under_18' | 'adult'
export type RunSource = 'pages' | 'app' | 'repo'

export interface AppSource {
  id: string
  projectId: string
  appUrl: string
  loginDomains: string[]
  updatedBy: string | null
  updatedAt: string
}

export interface TestAccount {
  id: string
  projectId: string
  label: string
  ageGroup: AgeGroup
  age: number | null
  loginName: string
  handles: string[]
  passwordCiphertext: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** The caller supplies `id`, because the encryption's AAD needs it. */
export type NewTestAccount = Omit<TestAccount, 'createdAt' | 'updatedAt'>

export type TestAccountPatch = Partial<
  Pick<TestAccount, 'label' | 'ageGroup' | 'age' | 'loginName' | 'handles' | 'passwordCiphertext'>
>

/** What the AI may know about an account. Deliberately no login name and no password. */
export interface AgentAccount {
  id: string
  label: string
  ageGroup: AgeGroup
  age: number | null
  handles: string[]
}

export interface AppElementState {
  checked?: boolean
  selected?: boolean
  disabled?: boolean
  expanded?: boolean
  value?: string
  options?: string[]
}

export interface AppElement {
  ref: string
  role: string
  name: string
  tag: string
  inputType: string | null
  href: string | null
  /** g1, g2, ...: the nearest enclosing form, dialog or composer; null when none. */
  groupId: string | null
  /** l1, l2, ...: the nearest enclosing listbox or menu, for its options; absent or null when none. */
  listId?: string | null
  state: AppElementState
  contextText: string
  /** The name of the fieldset or group the control is one of, such as "Who can tag you"; empty or missing when it has none. */
  groupLabel?: string
}

/** Every URL here (`url`, `href`, `frameUrls`) is already redacted; the real addresses stay in the isolated world. */
export interface AppView {
  url: string
  title: string
  text: string
  elements: AppElement[]
  frameUrls: string[]
  hasPasswordField: boolean
}

/** `account` and `target` are account labels. */
export type AppAction =
  | { type: 'open_link'; ref?: string; url?: string }
  | { type: 'click'; ref: string; target?: string }
  | { type: 'type'; ref: string; text: string }
  | { type: 'fill_credential'; ref: string; account: string; field: 'login' | 'password' }
  | { type: 'select'; ref: string; option: string }
  | { type: 'toggle'; ref: string; target?: string }
  | { type: 'back' }
  | { type: 'switch_account'; account: string }
  | { type: 'finish'; observations: string; evidenceSteps: number[] }

export type AppStepOutcome = 'done' | 'refused' | 'failed' | 'blocked'

export interface AppStep {
  id: string
  runId: string
  itemId: string
  /** Starts at 1 in each check; the same number as `Step <n>` in the line, the replay and `evidenceSteps`. */
  position: number
  accountId: string | null
  accountLabel: string | null
  action: AppAction
  line: string
  outcome: AppStepOutcome
  refusalReason: string | null
  pageId: string | null
  createdAt: string
}

export type NewAppStep = Omit<AppStep, 'id' | 'createdAt'>

export interface AppChange {
  id: string
  runId: string
  itemId: string
  accountId: string | null
  accountLabel: string
  pageUrl: string
  role: string
  control: string
  before: string
  after: string
  saveControl: string | null
  restored: boolean
  restoreDetail: string | null
  createdAt: string
}

/** A new change starts unrestored. */
export type NewAppChange = Omit<AppChange, 'id' | 'createdAt' | 'restored' | 'restoreDetail'>

export interface StoppedBy {
  url: string
  detail: string
}
