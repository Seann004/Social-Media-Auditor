import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { backendSupabaseKey } from './supabaseKey.js'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || ''
const { key, warning } = backendSupabaseKey(process.env)
if (warning) console.error(`[supabase] ${warning}`)

/** The backend's database client. It never reaches the browser, which only holds the anon key. */
export const supabase = createClient(supabaseUrl, key, { auth: { persistSession: false } })
