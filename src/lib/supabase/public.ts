import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/env";
import { sandboxClient, sandboxOptions } from "@/lib/supabase/sandbox";

// Public website reads: always the anonymous role, never the visitor's session, so
// pages show exactly what the public-read RLS policies allow — even for signed-in staff.
export function createPublicSupabaseClient() {
  const { url, key } = getSupabasePublicEnv();
  // sandboxOptions()/sandboxClient() do nothing outside demo mode.
  return sandboxClient(createClient(url, key, { ...sandboxOptions(), auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
}
