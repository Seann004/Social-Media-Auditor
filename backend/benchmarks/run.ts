/**
 * The benchmark script: npm run benchmark --prefix backend -- [options]. See README.md.
 * It calls the real AI and costs tokens, so it is never part of npm test.
 */
// Loads backend/.env into the environment, as the server does. Nothing in the benchmark prints or writes it.
import 'dotenv/config'
import { INTERRUPTED_EXIT_CODE, main } from './cli.js'

let onInterrupt: (() => Promise<void>) | null = null

// The first Ctrl+C writes the partial report and exits; a second one, while that is under way, kills at once.
process.once('SIGINT', () => {
  console.error('Interrupted: writing the partial report. Press Ctrl+C again to stop at once.')
  const writing = onInterrupt === null ? Promise.resolve() : onInterrupt()
  writing
    .catch((err: unknown) => console.error('Could not write the partial report:', err instanceof Error ? err.message : String(err)))
    .finally(() => process.exit(INTERRUPTED_EXIT_CODE))
})

const code = await main(
  process.argv.slice(2),
  process.env,
  { log: (line) => console.log(line), error: (line) => console.error(line) },
  {
    onInterrupt: (handler) => {
      onInterrupt = handler
    },
  },
)
process.exitCode = code
