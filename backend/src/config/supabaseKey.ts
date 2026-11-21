export interface BackendKey {
  key: string
  role: 'service_role' | 'anon'
  warning?: string
}

/**
 * The key the backend talks to Supabase with. The service-role key is preferred: the backend checks every
 * request itself, so the database can then refuse the public anon key that ships in the browser bundle.
 * The anon key is only a fallback for a setup that has not added the service-role key yet.
 */
export function backendSupabaseKey(env: Record<string, string | undefined>): BackendKey {
  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (service) return { key: service, role: 'service_role' }
  return {
    key: env.SUPABASE_ANON_KEY?.trim() ?? '',
    role: 'anon',
    warning:
      'SUPABASE_SERVICE_ROLE_KEY is not set, so the backend uses the public anon key. ' +
      'Set it in backend/.env: once row level security is on, the anon key can no longer read the tables.',
  }
}
