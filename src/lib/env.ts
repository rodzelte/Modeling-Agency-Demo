import { DEMO_ANON_KEY, DEMO_MODE, DEMO_SANDBOX_URL } from "@/lib/demo";

// Browser-safe Supabase settings. The secret key is read only by
// src/lib/supabase/admin.ts (server-only) and must never reach client code.
export function getSupabasePublicEnv() {
  // Demo mode never reads the project settings: clients are pointed at the
  // in-memory sandbox, whatever the environment happens to contain.
  if (DEMO_MODE) return { url: DEMO_SANDBOX_URL, key: DEMO_ANON_KEY };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (key.startsWith("sb_secret_") || key.includes("service_role")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be the publishable/anon key, never a secret key");
  }
  return { url, key };
}
