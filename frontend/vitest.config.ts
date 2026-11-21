import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // A few page tests take 3-4 s alone and pass 5 s under a full coverage run; 15 s leaves room.
    testTimeout: 15000,
    // Tests live in tests/unit/. The src pattern is a safety net, so a test added next to its code still runs.
    include: ['tests/unit/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
})
