import { createBrowserClient } from '@supabase/ssr'

// Single shared Supabase client for the browser.
// Reads the project URL and anon key from environment variables
// (set these in .env.local — see .env.local.example).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
