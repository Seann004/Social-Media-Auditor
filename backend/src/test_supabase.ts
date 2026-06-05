import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || ''

console.log("Supabase URL:", supabaseUrl)
const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testSupabase() {
  console.log("Testing Supabase connection...");
  try {
    const { data, error } = await supabase.from('Guideline').select('guidelineId').limit(1);
    if (error) {
      console.error("Supabase select error:", error);
    } else {
      console.log("Supabase select success:", data);
    }
  } catch (err) {
    console.error("Fetch exception:", err);
  }
}

testSupabase();
