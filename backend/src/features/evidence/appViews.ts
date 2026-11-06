/** What the browser is shown of app evidence. A test account's view never carries its password or ciphertext. */
import type { AgeGroup, AppChange, AppSource, AppStep, AppStepOutcome, TestAccount } from './appTypes.js'
import type { PageSummary } from './types.js'

export interface TestAccountView {
  id: string
  label: string
  ageGroup: AgeGroup
  age: number | null
  loginName: string
  handles: string[]
  /** Always true: an account cannot be saved without one. The password itself is write-only. */
  hasPassword: true
  updatedAt: string
}

export interface AppSourceView {
  appUrl: string
  loginDomains: string[]
  updatedAt: string
}

export interface AppStepView {
  id: string
  position: number
  accountLabel: string | null
  line: string
  outcome: AppStepOutcome
  refusalReason: string | null
  pageId: string | null
  hasScreenshot: boolean
}

export interface AppChangeView {
  id: string
  itemId: string
  accountLabel: string
  pageUrl: string
  control: string
  before: string
  after: string
  restored: boolean
  restoreDetail: string | null
}

export function toTestAccountView(account: TestAccount): TestAccountView {
  return {
    id: account.id,
    label: account.label,
    ageGroup: account.ageGroup,
    age: account.age,
    loginName: account.loginName,
    handles: [...account.handles],
    hasPassword: true,
    updatedAt: account.updatedAt,
  }
}

export function toAppSourceView(source: AppSource): AppSourceView {
  return { appUrl: source.appUrl, loginDomains: [...source.loginDomains], updatedAt: source.updatedAt }
}

/** `pages` holds the step pages by id; a step whose page has a picture can show it. */
export function toAppStepView(step: AppStep, pages: ReadonlyMap<string, PageSummary>): AppStepView {
  const page = step.pageId ? pages.get(step.pageId) : undefined
  return {
    id: step.id,
    position: step.position,
    accountLabel: step.accountLabel,
    line: step.line,
    outcome: step.outcome,
    refusalReason: step.refusalReason,
    pageId: step.pageId,
    hasScreenshot: page !== undefined && page.screenshotPath !== null,
  }
}

export function toAppChangeView(change: AppChange): AppChangeView {
  return {
    id: change.id,
    itemId: change.itemId,
    accountLabel: change.accountLabel,
    pageUrl: change.pageUrl,
    control: change.control,
    before: change.before,
    after: change.after,
    restored: change.restored,
    restoreDetail: change.restoreDetail,
  }
}
