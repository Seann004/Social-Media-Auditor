import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom does not implement scrollTo; the login page's motion library calls it.
window.scrollTo = () => {}

// Same for scrollIntoView, which the audit page calls on a timer after jumping to a flagged item.
window.HTMLElement.prototype.scrollIntoView = () => {}

// findBy and waitFor wait up to 3 s (default 1 s): a full run with coverage on a laptop can be that slow.
configure({ asyncUtilTimeout: 3000 })

afterEach(() => {
  cleanup()
})
