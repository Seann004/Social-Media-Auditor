import { describe, expect, it } from 'vitest'
import { backendSupabaseKey } from '../../../src/config/supabaseKey.js'

describe('backendSupabaseKey', () => {
  it('uses the service-role key when it is set, so row level security can lock out the public key', () => {
    expect(backendSupabaseKey({ SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' })).toEqual({
      key: 'service',
      role: 'service_role',
    })
  })

  it('falls back to the anon key with a warning when the service-role key is missing or blank', () => {
    for (const service of [undefined, '', '   ']) {
      const result = backendSupabaseKey({ SUPABASE_SERVICE_ROLE_KEY: service, SUPABASE_ANON_KEY: 'anon' })
      expect(result.key).toBe('anon')
      expect(result.role).toBe('anon')
      expect(result.warning).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
    }
  })

  it('gives an empty key when neither is set, so createClient reports the missing configuration', () => {
    expect(backendSupabaseKey({}).key).toBe('')
  })
})
