import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_MODE, withDemoFileUrls } from "@/lib/demo";

// Demo mode only: every server-side Supabase client is given this fetch, which
// answers from the in-memory sandbox (src/demo/sandbox) inside this process.
// The import sits behind the literal build-time flag so a production build
// never bundles, loads or reaches the sandbox.
const sandboxFetch: typeof fetch = async (input, init) => {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    const sandbox = await import("@/demo/sandbox/fetch");
    return sandbox.sandboxFetch(input, init);
  }
  throw new Error("The demo sandbox is not part of this build");
};

// Extra client options: the sandbox fetch in demo mode, nothing otherwise.
export function sandboxOptions(): { global?: { fetch: typeof fetch } } {
  return DEMO_MODE ? { global: { fetch: sandboxFetch } } : {};
}

export function sandboxClient<Client extends SupabaseClient>(client: Client): Client {
  return DEMO_MODE ? withDemoFileUrls(client) : client;
}

// The sandbox's own service-role token, for the integration code paths that use
// the secret key in production. It is minted per boot and only works in-process.
export async function sandboxServiceToken(): Promise<string> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    const jwt = await import("@/demo/sandbox/jwt");
    return jwt.serviceRoleKey();
  }
  throw new Error("The demo sandbox is not part of this build");
}
