import { MAX_CONCURRENT_RUNS } from './config.js'

export interface RunQueue {
  /** Never throws. */
  enqueue(runId: string): void
  /** Resolves when nothing is running or waiting. */
  idle(): Promise<void>
}

/** An in-process queue. A job that throws is logged and does not stop the ones after it. */
export function createRunQueue(worker: (runId: string) => Promise<void>, concurrency: number = MAX_CONCURRENT_RUNS): RunQueue {
  const waiting: string[] = []
  let running = 0
  let idleWaiters: (() => void)[] = []

  const settleIdle = () => {
    if (running > 0 || waiting.length > 0) return
    const waiters = idleWaiters
    idleWaiters = []
    waiters.forEach((resolve) => resolve())
  }

  const runJob = async (runId: string): Promise<void> => {
    try {
      await worker(runId)
    } catch (err) {
      console.error(`Evidence run ${runId} ended with an unexpected error:`, err instanceof Error ? err.message : 'unknown error')
    }
  }

  const pump = () => {
    while (running < Math.max(1, concurrency) && waiting.length > 0) {
      const runId = waiting.shift() as string
      running += 1
      void runJob(runId).finally(() => {
        running -= 1
        pump()
        settleIdle()
      })
    }
  }

  return {
    enqueue(runId) {
      waiting.push(runId)
      pump()
    },
    idle() {
      if (running === 0 && waiting.length === 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve)
      })
    },
  }
}
