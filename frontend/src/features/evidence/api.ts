import { BASE_URL } from '../../lib/db'
import { useStore } from '../../store/useStore'
import type {
  AppSetupResponse,
  AppSourceView,
  AppChangeView,
  CodeEvidence,
  RepoSourceView,
  DecisionRequest,
  DecisionResponse,
  EvidencePermission,
  LatestRunResponse,
  RunScope,
  RunStartResponse,
  ScreenshotKind,
  SourcesResponse,
  EvidenceSource,
  StepsResponse,
  SuggestionsResponse,
  TestAccountInput,
  TestAccountView,
} from './types'

/** Every failure of the evidence API. `status` is 0 when the server could not be reached. */
export class EvidenceApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'EvidenceApiError'
    this.status = status
  }
}

const NO_SESSION_MESSAGE = 'You are not signed in to the evidence service. Sign out and sign in again.'
const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'
const BAD_REPLY_MESSAGE = 'The server sent a reply that could not be read.'

const MESSAGE_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'The request was not valid.',
  401: 'Your session has expired. Sign out and sign in again.',
  403: 'You do not have access to this project.',
  404: 'That was not found.',
  409: 'That conflicts with the current state. Refresh and try again.',
  413: 'The request was too large.',
  422: 'The request could not be processed.',
  429: 'Too many requests. Wait a moment and try again.',
  502: 'The server is temporarily unreachable. Try again shortly.',
  503: 'The service is temporarily unavailable. Try again shortly.',
}

function plainMessage(status: number): string {
  return MESSAGE_BY_STATUS[status] ?? (status >= 500 ? 'Something went wrong on the server.' : 'The request failed.')
}

/** The server's own sentence when it sent `{ error: string }`; otherwise a plain message. Never the raw body. */
async function failureMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const sentence = (body as { error: unknown }).error
      if (typeof sentence === 'string' && sentence.trim() !== '') return sentence
    }
  } catch {
    // Not JSON (a proxy's page, say): fall through to the plain message.
  }
  return plainMessage(res.status)
}

async function call<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const token = useStore.getState().sessionToken
  if (!token) throw new EvidenceApiError(401, NO_SESSION_MESSAGE)

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new EvidenceApiError(0, NETWORK_MESSAGE)
  }
  if (!res.ok) throw new EvidenceApiError(res.status, await failureMessage(res))
  if (res.status === 204) return undefined as T
  try {
    return (await res.json()) as T
  } catch {
    throw new EvidenceApiError(res.status, BAD_REPLY_MESSAGE)
  }
}

const project = (projectId: string): string => `/projects/${encodeURIComponent(projectId)}`

export function getSources(projectId: string): Promise<SourcesResponse> {
  return call(`${project(projectId)}/evidence-sources`)
}

export function saveSources(projectId: string, startUrls: string[]): Promise<{ source: EvidenceSource }> {
  return call(`${project(projectId)}/evidence-sources`, 'POST', { startUrls })
}

export function setPermission(projectId: string, granted: boolean, note?: string): Promise<{ permission: EvidencePermission }> {
  return call(`${project(projectId)}/evidence-permission`, 'PUT', note === undefined ? { granted } : { granted, note })
}

export function startRun(projectId: string): Promise<RunStartResponse> {
  return call(`${project(projectId)}/evidence-runs`, 'POST')
}

export function reassess(projectId: string, runId: string, scope: RunScope): Promise<RunStartResponse> {
  return call(`${project(projectId)}/evidence-runs/${encodeURIComponent(runId)}/reassess`, 'POST', { scope })
}

export function getLatestRun(projectId: string): Promise<LatestRunResponse> {
  return call(`${project(projectId)}/evidence-runs/latest`)
}

export function getSuggestions(projectId: string): Promise<SuggestionsResponse> {
  return call(`${project(projectId)}/suggestions`)
}

export function postDecision(suggestionId: string, decision: DecisionRequest): Promise<DecisionResponse> {
  return call(`/suggestions/${encodeURIComponent(suggestionId)}/decision`, 'POST', decision)
}

/** A short-lived signed link to a captured page or a highlighted quote. */
export async function getScreenshotUrl(kind: ScreenshotKind, id: string): Promise<string> {
  const { url } = await call<{ url: string }>(`/evidence/screenshots/${kind}/${encodeURIComponent(id)}`)
  return url
}

export function getAppSetup(projectId: string): Promise<AppSetupResponse> {
  return call(`${project(projectId)}/app-setup`)
}

export function saveAppSource(projectId: string, appUrl: string, loginDomains: string[]): Promise<{ app: AppSourceView }> {
  return call(`${project(projectId)}/app-source`, 'PUT', { appUrl, loginDomains })
}

export function addTestAccount(projectId: string, input: TestAccountInput): Promise<{ account: TestAccountView }> {
  return call(`${project(projectId)}/test-accounts`, 'POST', input)
}

/** A blank or missing password is left out of the request, so it never wipes the saved one. */
export function updateTestAccount(projectId: string, accountId: string, input: TestAccountInput): Promise<{ account: TestAccountView }> {
  const { password, ...rest } = input
  const body = password ? { ...rest, password } : rest
  return call(`${project(projectId)}/test-accounts/${encodeURIComponent(accountId)}`, 'PATCH', body)
}

export function deleteTestAccount(projectId: string, accountId: string): Promise<void> {
  return call(`${project(projectId)}/test-accounts/${encodeURIComponent(accountId)}`, 'DELETE')
}

export function startAppRun(projectId: string, itemIds: string[]): Promise<RunStartResponse> {
  return call(`${project(projectId)}/app-runs`, 'POST', { itemIds })
}

export function getRunChanges(projectId: string, runId: string): Promise<{ changes: AppChangeView[] }> {
  return call(`${project(projectId)}/evidence-runs/${encodeURIComponent(runId)}/app-changes`)
}

export function getSuggestionSteps(suggestionId: string): Promise<StepsResponse> {
  return call(`/suggestions/${encodeURIComponent(suggestionId)}/steps`)
}

export function getRepoSource(projectId: string): Promise<{ repo: RepoSourceView | null }> {
  return call(`${project(projectId)}/repo-source`)
}

export function saveRepoSource(projectId: string, input: { repoUrl: string; branch: string | null }): Promise<{ repo: RepoSourceView }> {
  return call(`${project(projectId)}/repo-source`, 'PUT', input)
}

export function startRepoRun(projectId: string, itemIds: string[]): Promise<RunStartResponse> {
  return call(`${project(projectId)}/repo-runs`, 'POST', { itemIds })
}

export function getCode(suggestionId: string): Promise<CodeEvidence> {
  return call(`/suggestions/${encodeURIComponent(suggestionId)}/code`)
}
