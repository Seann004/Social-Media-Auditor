import { describe, it, expect } from 'vitest'
import { isValidBranch, parseRepoUrl, permalinkOf } from './repoAddress.js'

describe('parseRepoUrl', () => {
  it('accepts a normal address, with .git, a slash and spaces around it', () => {
    const expected = { repoUrl: 'https://github.com/acme/social-app', owner: 'acme', name: 'social-app' }
    expect(parseRepoUrl('https://github.com/acme/social-app.git ')).toEqual(expected)
    expect(parseRepoUrl('  https://github.com/acme/social-app/')).toEqual(expected)
    expect(parseRepoUrl('https://github.com/acme/social-app')).toEqual(expected)
  })

  it.each([
    'http://github.com/a/b',
    'https://gitlab.com/a/b',
    'https://github.com/a',
    'https://github.com/a/b/tree/main',
    'https://github.com.evil.example/a/b',
    'https://github.com/../b',
    'https://github.com/a/..',
    'https://github.com/-a/b',
    'https://github.com/a/b?x=1',
    '',
  ])('refuses %j', (input) => {
    expect(parseRepoUrl(input)).toBeNull()
  })
})

describe('isValidBranch', () => {
  it.each(['main', 'feature/x', 'v1.2.3', 'a_b-c'])('accepts %s', (b) => expect(isValidBranch(b)).toBe(true))
  it.each(['', '../x', '-x', 'x.lock', 'a//b', '/x', 'x/', 'x.', 'a b', 'a'.repeat(256)])('refuses %j', (b) =>
    expect(isValidBranch(b)).toBe(false),
  )
})

describe('permalinkOf', () => {
  it('encodes each path segment and gives the line range', () => {
    const sha = 'f'.repeat(40)
    expect(permalinkOf('a', 'b', sha, 'src/my file.ts', 3, 9)).toBe(`https://github.com/a/b/blob/${sha}/src/my%20file.ts#L3-L9`)
  })
})
