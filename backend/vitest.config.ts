import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'benchmarks/**/*.test.ts'],
    testTimeout: 30000,
  },
})
