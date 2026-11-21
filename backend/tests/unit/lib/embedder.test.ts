import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cosine, createEmbedder, normalise } from '../../../src/lib/embedder.js'

const fetchMock = vi.fn()
const ENV = { HF_API_TOKEN: 'hf_test' }

const ok = (vectors: number[][]) => new Response(JSON.stringify(vectors), { status: 200 })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('vector helpers', () => {
  it('normalises a vector to length 1', () => {
    const v = normalise([3, 4])
    expect(v[0]).toBeCloseTo(0.6)
    expect(v[1]).toBeCloseTo(0.8)
  })

  it('leaves a zero vector alone instead of dividing by zero', () => {
    expect(normalise([0, 0])).toEqual([0, 0])
  })

  it('gives cosine 1 for the same direction, 0 for orthogonal, and 0 for different lengths', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([1, 0], [1, 0, 0])).toBe(0)
  })
})

describe('createEmbedder', () => {
  it('is null without a token, so callers fall back to word matching', () => {
    expect(createEmbedder({})).toBeNull()
    expect(createEmbedder({ HF_API_TOKEN: '  ' })).toBeNull()
  })

  it('can be switched off even with a token', () => {
    expect(createEmbedder({ ...ENV, EMBEDDINGS: 'off' })).toBeNull()
  })

  it('returns normalised vectors in input order and sends the token', async () => {
    fetchMock.mockResolvedValueOnce(ok([[3, 4], [0, 2]]))
    const embedder = createEmbedder(ENV)!
    const out = await embedder.embed(['a', 'b'])
    expect(out[0][0]).toBeCloseTo(0.6)
    expect(out[1]).toEqual([0, 1])
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer hf_test')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).inputs).toEqual(['a', 'b'])
  })

  it('sends long lists in batches and keeps the order', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const inputs = JSON.parse(init.body).inputs as string[]
      return ok(inputs.map((t) => [Number(t), 1]))
    })
    const embedder = createEmbedder({ ...ENV, EMBEDDING_BATCH_SIZE: '2' })!
    const out = await embedder.embed(['1', '2', '3', '4', '5'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(out.map((v) => Math.round(v[0] * Math.SQRT2 * 1000) / 1000)).toEqual(expect.arrayContaining([]))
    expect(out).toHaveLength(5)
    expect(out[4][0]).toBeGreaterThan(out[0][0])
  })

  it('waits and tries again while the model is loading (503)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('loading', { status: 503 })).mockResolvedValueOnce(ok([[1, 0]]))
    const embedder = createEmbedder({ ...ENV, EMBEDDING_RETRY_WAIT_MS: '0' })!
    expect(await embedder.embed(['a'])).toEqual([[1, 0]])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws on other errors without leaking the token', async () => {
    fetchMock.mockResolvedValue(new Response('bad token hf_test', { status: 401 }))
    const embedder = createEmbedder(ENV)!
    const err = await embedder.embed(['a']).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('401')
    expect((err as Error).message).not.toContain('hf_test')
  })

  it('throws when the reply is not one vector per text', async () => {
    fetchMock.mockResolvedValueOnce(ok([[1, 0]]))
    await expect(createEmbedder(ENV)!.embed(['a', 'b'])).rejects.toThrow(/unexpected/i)
  })

  it('returns nothing for no texts, without calling out', async () => {
    expect(await createEmbedder(ENV)!.embed([])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
