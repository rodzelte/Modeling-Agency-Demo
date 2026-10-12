import "server-only";
import { createClient } from "@supabase/supabase-js";
import { DEMO_MODE } from "@/lib/demo";
import { getSupabasePublicEnv } from "@/lib/env";
import { sandboxClient, sandboxOptions, sandboxServiceToken } from "@/lib/supabase/sandbox";

// The ONLY service-role client. It bypasses RLS, so it is limited to server-side
// integrations that have no signed-in user and authenticate some other way
// (the GHL webhook checks a shared secret). Never import it from pages, client
// components, or dashboard routes: those run as the signed-in user.
export function createAdminSupabaseClient() {
  const { url, key: publicKey } = getSupabasePublicEnv();
  // Demo mode: the sandbox's own service role. SUPABASE_SECRET_KEY is never read.
  if (DEMO_MODE) {
    return sandboxClient(createClient(url, publicKey, { ...sandboxOptions(), accessToken: sandboxServiceToken }));
  }
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing required server environment variable: SUPABASE_SECRET_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
