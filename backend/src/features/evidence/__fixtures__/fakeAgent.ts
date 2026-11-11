import type { DecideStep, StepPrompt } from '../appAgent.js'
import { outlineLines } from '../appRead.js'
import type { AppAction } from '../appTypes.js'

/** One scripted answer: an action, or a function of the prompt that returns one (or throws, as a failing AI would). */
export type ScriptEntry = AppAction | ((p: StepPrompt) => AppAction)

export interface ScriptedAgentOptions {
  /** Tokens reported for every answer. Defaults to 100. */
  tokensPerStep?: number
}

const FINISH: AppAction = { type: 'finish', observations: '', evidenceSteps: [] }

/**
 * A DecideStep that answers from a script, one entry per call, and keeps a copy of every prompt it was
 * given. A finished script answers `finish`.
 */
export function scriptedAgent(script: ScriptEntry[], opts: ScriptedAgentOptions = {}): DecideStep & { prompts: StepPrompt[] } {
  const prompts: StepPrompt[] = []
  let next = 0
  const decide: DecideStep = async ({ prompt }) => {
    prompts.push(structuredClone(prompt))
    const entry = next < script.length ? script[next] : FINISH
    next += 1
    const action = typeof entry === 'function' ? entry(prompt) : entry
    return { action, note: '', tokensUsed: opts.tokensPerStep ?? 100 }
  }
  return Object.assign(decide, { prompts })
}

/** The ref of the element with this role and name on the prompt's page; throws with the outline when there is none. */
export function refOf(p: StepPrompt, role: string, name: string): string {
  const view = p.view
  const found = view?.elements.find((el) => el.role === role && el.name === name)
  if (found === undefined) {
    throw new Error(`No ${role} "${name}" on the page:\n${view === null ? '(no page)' : outlineLines(view)}`)
  }
  return found.ref
}
