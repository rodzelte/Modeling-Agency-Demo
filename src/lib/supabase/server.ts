import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "@/lib/env";
import { sandboxClient, sandboxOptions } from "@/lib/supabase/sandbox";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const { url, key } = getSupabasePublicEnv();

  // sandboxOptions()/sandboxClient() do nothing outside demo mode.
  return sandboxClient(createServerClient(url, key, {
    ...sandboxOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot always write cookies; the proxy owns refresh persistence.
        }
      },
    },
  }));
}
