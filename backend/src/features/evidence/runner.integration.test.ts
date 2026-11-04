import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isJpeg } from './__fixtures__/highlightHelpers.js'
import { html, quietLogUnlessTestFails, startPageServer, TEST_TIMEOUT_MS, type PageServer } from './__fixtures__/pages.js'
import { createWorld, DEFAULT_ITEMS, PROJECT, SENTENCE } from './__fixtures__/runnerWorld.js'
import { closeBrowser } from './browser.js'
import { createMemoryRepository } from './memoryRepository.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

const MADE_UP = 'All accounts are deleted after thirty days.'

let server: PageServer

beforeAll(async () => {
  server = await startPageServer({
    '/privacy': html('Privacy', `<p>${SENTENCE}</p><p>Reporting tools let users report abuse quickly.</p>`),
  })
})

afterAll(async () => {
  await server.close()
  await closeBrowser()
})

beforeEach(() => quietLogUnlessTestFails())

afterEach(() => vi.restoreAllMocks())

describe('runEvidenceJob through a local site', () => {
  it('gives a verified quote a highlight picture and an unmatched one none', async () => {
    const repo = createMemoryRepository()
    const uploads = new Map<string, Buffer>()
    const upload = repo.upload.bind(repo)
    repo.upload = async (path, jpeg) => {
      uploads.set(path, jpeg)
      return upload(path, jpeg)
    }
    const world = await createWorld({
      repo,
      items: [DEFAULT_ITEMS[0]],
      startUrls: [`${server.url}/privacy`],
      assess: (input) => ({
        results: [
          {
            itemId: 'i1',
            suggestedResult: 'yes',
            reason: 'The page says so.',
            quotes: [
              { passageId: input.passages[0].id, text: SENTENCE },
              { passageId: input.passages[0].id, text: MADE_UP },
            ],
            evidenceSufficient: true,
            conflicting: false,
            webAssessable: true,
            confidence: 'high',
          },
        ],
        missingItemIds: [],
        tokensUsed: 10,
      }),
    })
    // The real capture, highlights and browser, on a site this machine serves.
    world.deps.capture = undefined
    world.deps.highlights = undefined
    world.deps.browserProvider = undefined
    world.deps.guard = server.guard('127.0.0.1')

    const run = await world.run()
    const [suggestion] = await world.suggestions(run.id)
    const pages = await repo.listPages(run.id)

    expect(run.status).toBe('completed')
    expect(pages).toHaveLength(1)
    expect(pages[0].accessStatus).toBe('ok')
    expect(pages[0].screenshotPath?.startsWith(`${PROJECT}/`)).toBe(true)

    const verified = suggestion.quotes.find((q) => q.quoteText === SENTENCE)
    const unmatched = suggestion.quotes.find((q) => q.quoteText === MADE_UP)
    expect(verified?.verified).toBe(true)
    expect(verified?.pageId).toBe(pages[0].id)
    expect(verified?.highlightScreenshotPath?.startsWith(`${PROJECT}/`)).toBe(true)
    expect(isJpeg(uploads.get(verified?.highlightScreenshotPath as string) as Buffer)).toBe(true)
    expect(unmatched?.verified).toBe(false)
    expect(unmatched?.highlightScreenshotPath).toBeNull()
    expect(suggestion.flags.map((f) => f.type)).toContain('unverified_quote')
  })
})
