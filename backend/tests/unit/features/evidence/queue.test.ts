import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRunQueue } from '../../../../src/features/evidence/queue.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

afterEach(() => vi.restoreAllMocks())

describe('createRunQueue', () => {
  it('runs at most one job at a time and starts the next when one finishes', async () => {
    const gates = new Map([['a', deferred()], ['b', deferred()], ['c', deferred()]])
    const started: string[] = []
    let running = 0
    let peak = 0
    const queue = createRunQueue(async (id) => {
      started.push(id)
      running += 1
      peak = Math.max(peak, running)
      await gates.get(id)!.promise
      running -= 1
    })

    queue.enqueue('a')
    queue.enqueue('b')
    queue.enqueue('c')
    await Promise.resolve()
    expect(started).toEqual(['a'])

    gates.get('a')!.resolve()
    await vi.waitFor(() => expect(started).toEqual(['a', 'b']))
    gates.get('b')!.resolve()
    await vi.waitFor(() => expect(started).toEqual(['a', 'b', 'c']))
    gates.get('c')!.resolve()
    await queue.idle()
    expect(peak).toBe(1)
  })

  it('a job that throws does not stop the queue', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const done: string[] = []
    const queue = createRunQueue(async (id) => {
      if (id === 'bad') throw new Error('boom')
      done.push(id)
    })

    queue.enqueue('bad')
    queue.enqueue('good')
    await queue.idle()

    expect(done).toEqual(['good'])
    expect(error).toHaveBeenCalled()
  })

  it('a job that throws without a promise (synchronously) does not stop the queue either', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const done: string[] = []
    const queue = createRunQueue(((id: string) => {
      if (id === 'bad') throw new Error('sync boom')
      done.push(id)
      return Promise.resolve()
    }) as (id: string) => Promise<void>)

    queue.enqueue('bad')
    queue.enqueue('good')
    await queue.idle()
    expect(done).toEqual(['good'])
  })

  it('idle resolves at once when nothing was queued, and runs up to the concurrency given', async () => {
    const queue = createRunQueue(async () => undefined, 2)
    await queue.idle()

    const gates = [deferred(), deferred(), deferred()]
    let next = 0
    let running = 0
    let peak = 0
    const wide = createRunQueue(async () => {
      const gate = gates[next++]
      running += 1
      peak = Math.max(peak, running)
      await gate.promise
      running -= 1
    }, 2)
    wide.enqueue('1')
    wide.enqueue('2')
    wide.enqueue('3')
    await Promise.resolve()
    expect(next).toBe(2)
    gates.forEach((g) => g.resolve())
    await wide.idle()
    expect(peak).toBe(2)
  })
})
