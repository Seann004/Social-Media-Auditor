import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

let cached: SupabaseClient | null = null

/**
 * Service-role client for the evidence feature. Bypasses row level security,
 * so it must only be used by backend code. Returns null when the key is unset.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) return null
  if (!cached) {
    cached = createClient(url, key, { auth: { persistSession: false } })
  }
  return cached
}
