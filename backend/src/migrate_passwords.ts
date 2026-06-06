import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseAnonKey)

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

async function migrate() {
  console.log("Starting password migration...")
  
  // 1. Fetch all users
  const { data: users, error: fetchError } = await supabase
    .from('User')
    .select('userId, userName, userEmail, userPassword')
  
  if (fetchError) {
    console.error("Failed to fetch users:", fetchError)
    return
  }
  
  if (!users || users.length === 0) {
    console.log("No users found.")
    return
  }
  
  console.log(`Found ${users.length} users. Checking passwords...`)
  
  let migratedCount = 0
  let skippedCount = 0
  
  for (const user of users) {
    const pwd = user.userPassword
    if (!pwd) {
      console.log(`User ${user.userName} (${user.userEmail}) has no password. Skipping.`)
      skippedCount++
      continue
    }
    
    // Check if password is already a 64-char hex string
    const isAlreadyHashed = /^[0-9a-fA-F]{64}$/.test(pwd)
    
    if (isAlreadyHashed) {
      console.log(`User ${user.userName} (${user.userEmail}) has an already hashed password. Skipping.`)
      skippedCount++
      continue
    }
    
    // Hash the password
    const hashedPwd = sha256(pwd)
    console.log(`Hashing password for ${user.userName} (${user.userEmail}): "${pwd}" -> "${hashedPwd}"`)
    
    // Update database
    const { error: updateError } = await supabase
      .from('User')
      .update({ userPassword: hashedPwd })
      .eq('userId', user.userId)
      
    if (updateError) {
      console.error(`Failed to update password for ${user.userName}:`, updateError)
    } else {
      migratedCount++
    }
  }
  
  console.log("--- Migration Finished ---")
  console.log(`Total users checked: ${users.length}`)
  console.log(`Migrated: ${migratedCount}`)
  console.log(`Skipped: ${skippedCount}`)
}

migrate()
