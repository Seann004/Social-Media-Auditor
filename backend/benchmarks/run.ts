/**
 * The benchmark script: npm run benchmark --prefix backend -- [options]. See README.md.
 * It calls the real AI and costs tokens, so it is never part of npm test.
 */
// Loads backend/.env into the environment, as the server does. Nothing in the benchmark prints or writes it.
import 'dotenv/config'
import { main } from './cli.js'

const code = await main(process.argv.slice(2), process.env, {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
})
process.exitCode = code
