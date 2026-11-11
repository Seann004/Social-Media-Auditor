import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom does not implement scrollTo; the login page's motion library calls it.
window.scrollTo = () => {}

// Same for scrollIntoView, which the audit page calls on a timer after jumping to a flagged item.
window.HTMLElement.prototype.scrollIntoView = () => {}

afterEach(() => {
  cleanup()
})
