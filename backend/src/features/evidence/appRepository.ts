import type {
  AppChange,
  AppSource,
  AppStep,
  NewAppChange,
  NewAppStep,
  NewTestAccount,
  TestAccount,
  TestAccountPatch,
} from './appTypes.js'

export interface AppSourceInput {
  appUrl: string
  loginDomains: string[]
}

export interface AppChangePatch {
  restored?: boolean
  restoreDetail?: string | null
  saveControl?: string | null
}

export interface AppRepository {
  getAppSource(projectId: string): Promise<AppSource | null>
  /** One row per project: saving again replaces it. */
  saveAppSource(projectId: string, input: AppSourceInput, userId: string | null): Promise<AppSource>

  /** In label order. */
  listTestAccounts(projectId: string): Promise<TestAccount[]>
  getTestAccount(id: string): Promise<TestAccount | null>
  /** Throws when the project already has an account with the label. */
  addTestAccount(input: NewTestAccount): Promise<TestAccount>
  updateTestAccount(id: string, patch: TestAccountPatch): Promise<TestAccount>
  deleteTestAccount(id: string): Promise<void>

  addStep(input: NewAppStep): Promise<AppStep>
  /** One run's steps in position order, for one item or (without `itemId`) for all. */
  listSteps(runId: string, itemId?: string): Promise<AppStep[]>

  addChange(input: NewAppChange): Promise<AppChange>
  updateChange(id: string, patch: AppChangePatch): Promise<AppChange>
  listChanges(runId: string, opts?: { itemId?: string; unrestoredOnly?: boolean }): Promise<AppChange[]>
}
