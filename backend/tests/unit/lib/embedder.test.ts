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

describe('the Gemini embedder', () => {
  const G = { GEMINI_API_KEY: 'AIza-test-key', EMBEDDING_RETRY_WAIT_MS: '0' }
  const geminiReply = (vectors: number[][]) => new Response(JSON.stringify({ embeddings: vectors.map((values) => ({ values })) }), { status: 200 })

  it('is chosen over Hugging Face when both keys are set, and off with EMBEDDINGS=off', () => {
    expect(createEmbedder({ ...G, HF_API_TOKEN: 'hf_x' })!.model).toContain('gemini-embedding-001')
    expect(createEmbedder({ ...G, EMBEDDINGS: 'off' })).toBeNull()
  })

  it('names the model with its size, so vectors of another size are never mixed', () => {
    expect(createEmbedder(G)!.model).toBe('gemini-embedding-001@768')
    expect(createEmbedder({ ...G, EMBEDDING_DIMENSIONS: '256' })!.model).toBe('gemini-embedding-001@256')
  })

  it('sends the key in a header, not in the address, with the task type and size', async () => {
    fetchMock.mockResolvedValueOnce(geminiReply([[3, 4]]))
    const out = await createEmbedder(G)!.embed(['hello'], undefined, 'query')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).not.toContain('AIza-test-key')
    expect(init.headers['x-goog-api-key']).toBe('AIza-test-key')
    const request = JSON.parse(init.body).requests[0]
    expect(request).toMatchObject({ model: 'models/gemini-embedding-001', taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 })
    expect(request.content.parts[0].text).toBe('hello')
    expect(out[0][0]).toBeCloseTo(0.6)
  })

  it('uses the document task type by default', async () => {
    fetchMock.mockResolvedValueOnce(geminiReply([[1, 0]]))
    await createEmbedder(G)!.embed(['a'])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).requests[0].taskType).toBe('RETRIEVAL_DOCUMENT')
  })

  it('sends no query prefix, which only the bge models want', () => {
    expect(createEmbedder(G)!.queryPrefix).toBeUndefined()
  })

  it('splits long lists into batches of at most 100 and keeps the order', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const requests = JSON.parse(init.body).requests as { content: { parts: { text: string }[] } }[]
      return geminiReply(requests.map((r) => [Number(r.content.parts[0].text) + 1, 1]))
    })
    const texts = Array.from({ length: 230 }, (_, i) => String(i))
    const out = await createEmbedder(G)!.embed(texts)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(out).toHaveLength(230)
    expect(out[229][0]).toBeGreaterThan(out[0][0])
  })

  it('waits and tries again when the free tier says too many requests (429)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 })).mockResolvedValueOnce(geminiReply([[1, 0]]))
    expect(await createEmbedder(G)!.embed(['a'])).toEqual([[1, 0]])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after the last try and reports the status without the key', async () => {
    fetchMock.mockResolvedValue(new Response('quota AIza-test-key', { status: 429 }))
    const err = await createEmbedder(G)!.embed(['a']).catch((e: Error) => e)
    expect((err as Error).message).toContain('429')
    expect((err as Error).message).not.toContain('AIza')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('throws when the reply has the wrong number of vectors', async () => {
    fetchMock.mockResolvedValueOnce(geminiReply([[1, 0]]))
    await expect(createEmbedder(G)!.embed(['a', 'b'])).rejects.toThrow(/unexpected/i)
  })
})
