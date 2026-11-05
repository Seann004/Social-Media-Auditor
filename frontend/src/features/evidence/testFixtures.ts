// Builders for evidence tests. Not imported by app code.
import type { DecisionView, PageView, RunView, SuggestionView } from './types'

export function makeRun(overrides: Partial<RunView> = {}): RunView {
  return {
    id: 'run-1',
    projectId: 'p1',
    startedBy: 'u1',
    status: 'completed',
    capturedInRunId: 'run-1',
    scope: 'all',
    unassessedCategories: [],
    categoriesTotal: 4,
    categoriesDone: 4,
    pagesTotal: 3,
    pagesDone: 3,
    tokensUsed: 1000,
    model: 'm',
    promptVersion: 'evidence-v1',
    error: null,
    createdAt: '2026-11-04T09:00:00.000Z',
    startedAt: '2026-11-04T09:00:01.000Z',
    finishedAt: '2026-11-04T09:05:00.000Z',
    ...overrides,
  }
}

export function makePage(overrides: Partial<PageView> = {}): PageView {
  return {
    id: 'pg-1',
    url: 'https://example.com/',
    finalUrl: null,
    httpStatus: 200,
    accessStatus: 'ok',
    accessDetail: null,
    title: 'Home',
    hasScreenshot: true,
    capturedAt: '2026-11-04T09:01:00.000Z',
    ...overrides,
  }
}

export function makeSuggestion(overrides: Partial<SuggestionView> = {}): SuggestionView {
  return {
    id: 's-1',
    runId: 'run-1',
    projectId: 'p1',
    itemId: 'item-1',
    suggestedResult: 'yes',
    reason: 'Because.',
    confidence: 'high',
    flags: [],
    quotes: [],
    ...overrides,
  }
}

export function makeDecision(overrides: Partial<DecisionView> = {}): DecisionView {
  return {
    id: 'd-1',
    suggestionId: 's-1',
    itemId: 'item-1',
    userId: 'u1',
    decision: 'accepted',
    finalResult: 'compliant',
    overrideReason: null,
    origin: 'card',
    decidedAt: '2026-11-04T10:00:00.000Z',
    suggestedResult: 'yes',
    ...overrides,
  }
}
