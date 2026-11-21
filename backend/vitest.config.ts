import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Tests live in tests/<type>/. The src and benchmarks patterns are a safety net, so a test added next to its code still runs.
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'benchmarks/**/*.test.ts'],
    testTimeout: 30000,
  },
})
