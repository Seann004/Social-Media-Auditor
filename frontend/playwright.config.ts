import { defineConfig } from '@playwright/test'

// A spare port, so a dev server on 5173 is never reused or disturbed.
const APP_PORT = 5199
// Nothing listens here: every request to it is answered by a stub in the test.
const API_PLACEHOLDER = 'http://127.0.0.1:5198'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      // Names resolve only for the local machine, so nothing can leave it even if a stub were missed.
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
    },
  },
  webServer: {
    command: `npx vite --port ${APP_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${APP_PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // The pages-flow specs need the Public pages source, which the product build hides.
      VITE_E2E_PUBLIC_PAGES: 'true',
      VITE_API_URL: `${API_PLACEHOLDER}/api`,
      VITE_SUPABASE_URL: `${API_PLACEHOLDER}/supabase`,
      VITE_SUPABASE_ANON_KEY: 'e2e-placeholder-key',
    },
  },
})
