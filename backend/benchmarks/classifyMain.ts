/**
 * The item-kinds benchmark script: npm run benchmark:classify --prefix backend -- [options].
 * It calls the real AI and costs tokens, so it is never part of npm test. See classifyRun.ts.
 */
// Loads backend/.env into the environment, as the server does. Nothing here prints or writes it.
import 'dotenv/config'
import { main } from './classifyRun.js'

process.exitCode = await main(process.argv.slice(2), process.env, {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
})
