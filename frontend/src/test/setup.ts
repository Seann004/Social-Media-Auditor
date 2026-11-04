import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom does not implement scrollTo; the login page's motion library calls it.
window.scrollTo = () => {}

afterEach(() => {
  cleanup()
})
