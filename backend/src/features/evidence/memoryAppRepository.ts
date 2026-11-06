import { randomUUID } from 'node:crypto'
import type { AppRepository } from './appRepository.js'
import type { AppChange, AppSource, AppStep, TestAccount } from './appTypes.js'

const copy = <T>(v: T): T => structuredClone(v)
const byLabel = (a: TestAccount, b: TestAccount): number => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)

/** In-memory app repository for tests. Every result is a copy. */
export function createMemoryAppRepository(): AppRepository {
  const sources: AppSource[] = []
  const accounts: TestAccount[] = []
  const steps: AppStep[] = []
  const changes: AppChange[] = []

  const labelTaken = (projectId: string, label: string, exceptId?: string): boolean =>
    accounts.some((a) => a.projectId === projectId && a.label === label && a.id !== exceptId)

  return {
    async getAppSource(projectId) {
      const row = sources.find((s) => s.projectId === projectId)
      return row ? copy(row) : null
    },
    async saveAppSource(projectId, input, userId) {
      const index = sources.findIndex((s) => s.projectId === projectId)
      const row: AppSource = {
        id: index >= 0 ? sources[index].id : randomUUID(),
        projectId,
        appUrl: input.appUrl,
        loginDomains: [...input.loginDomains],
        updatedBy: userId,
        updatedAt: new Date().toISOString(),
      }
      if (index >= 0) sources[index] = row
      else sources.push(row)
      return copy(row)
    },

    async listTestAccounts(projectId) {
      return copy(accounts.filter((a) => a.projectId === projectId).sort(byLabel))
    },
    async getTestAccount(id) {
      const row = accounts.find((a) => a.id === id)
      return row ? copy(row) : null
    },
    async addTestAccount(input) {
      if (labelTaken(input.projectId, input.label)) {
        throw new Error('addTestAccount: the project already has an account with this label')
      }
      const now = new Date().toISOString()
      const row: TestAccount = { ...copy(input), createdAt: now, updatedAt: now }
      accounts.push(row)
      return copy(row)
    },
    async updateTestAccount(id, patch) {
      const index = accounts.findIndex((a) => a.id === id)
      if (index < 0) throw new Error(`updateTestAccount: account ${id} not found`)
      const current = accounts[index]
      if (patch.label !== undefined && labelTaken(current.projectId, patch.label, id)) {
        throw new Error('updateTestAccount: the project already has an account with this label')
      }
      accounts[index] = { ...current, ...copy(patch), updatedAt: new Date().toISOString() }
      return copy(accounts[index])
    },
    async deleteTestAccount(id) {
      const index = accounts.findIndex((a) => a.id === id)
      if (index >= 0) accounts.splice(index, 1)
    },

    async addStep(input) {
      const row: AppStep = { ...copy(input), id: randomUUID(), createdAt: new Date().toISOString() }
      steps.push(row)
      return copy(row)
    },
    async listSteps(runId, itemId) {
      return copy(
        steps
          .filter((s) => s.runId === runId && (itemId === undefined || s.itemId === itemId))
          .sort((a, b) => a.position - b.position),
      )
    },

    async addChange(input) {
      const row: AppChange = {
        ...copy(input),
        id: randomUUID(),
        restored: false,
        restoreDetail: null,
        createdAt: new Date().toISOString(),
      }
      changes.push(row)
      return copy(row)
    },
    async updateChange(id, patch) {
      const index = changes.findIndex((c) => c.id === id)
      if (index < 0) throw new Error(`updateChange: change ${id} not found`)
      changes[index] = { ...changes[index], ...copy(patch) }
      return copy(changes[index])
    },
    async listChanges(runId, opts = {}) {
      return copy(
        changes.filter(
          (c) =>
            c.runId === runId &&
            (opts.itemId === undefined || c.itemId === opts.itemId) &&
            (!opts.unrestoredOnly || !c.restored),
        ),
      )
    },
  }
}
