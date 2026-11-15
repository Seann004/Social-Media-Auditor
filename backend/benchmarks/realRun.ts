/**
 * The real AI and browser behind each repeat: the pipeline's own decideStep and assessBatch (the real
 * prompts, safety rules and judge, through callGroqJson) and the shared Playwright browser. Loaded only
 * for a real run.
 */
import { decideStep } from '../src/features/evidence/appAgent.js'
import { assessBatch } from '../src/features/evidence/assess.js'
import { closeBrowser } from '../src/features/evidence/browser.js'
import { DEFAULT_EVIDENCE_MODEL } from '../src/features/evidence/index.js'
import { runAppRepeat } from './appRepeat.js'
import type { Runner } from './cli.js'
import { runRepoRepeat } from './repoRepeat.js'
import { installGroqGate } from './world.js'

/** The model is EVIDENCE_GROQ_MODEL when set, else the server's default, exactly as the server picks it. */
export async function createRealRunner(apiKey: string, requestedModel: string | null): Promise<Runner> {
  const model = requestedModel ?? DEFAULT_EVIDENCE_MODEL
  const ai = { decideStep, assessBatch }
  return {
    model,
    runRepeat: async (c, repeat, budget) => {
      // No call to Groq leaves this process once the cap is reached, whichever part of the pipeline makes it.
      const restore = installGroqGate(budget)
      try {
        return await (c.source === 'app' ? runAppRepeat : runRepoRepeat)(c, repeat, { apiKey, model, ai, budget })
      } finally {
        restore()
      }
    },
    finish: closeBrowser,
  }
}
