import { chromium, type FullConfig } from '@playwright/test'

/**
 * Loads the app once before any test runs. The Vite dev server compiles the app on the first request, which
 * can take most of a minute on a busy machine; without this, that time is charged to whichever test runs
 * first and it times out on its first page.goto.
 */
export default async function warmUp(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL
  if (!baseURL) return
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    // Only the app's own files are fetched here: every other request is dropped, as the tests' stubs would.
    await page.route('**/*', (route) => (new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort()))
    await page.goto(baseURL, { waitUntil: 'load', timeout: 180_000 })
    await page.getByRole('heading', { name: 'Sign in' }).waitFor({ timeout: 180_000 })
  } finally {
    await browser.close()
  }
}
