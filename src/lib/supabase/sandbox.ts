import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_MODE, withDemoFileUrls } from "@/lib/demo";

// Demo mode only: every server-side Supabase client is given this fetch, which
// answers from the in-memory sandbox (src/demo/sandbox): inside this process on
// a single server, or through the one function that holds the sandbox on a
// serverless host (src/demo/remote.ts). The imports sit behind the literal
// build-time flag so a production build never bundles, loads or reaches any of it.
const sandboxFetch: typeof fetch = async (input, init) => {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    const remote = await import("@/demo/remote");
    if (remote.splitMode()) return remote.remoteFetch(input, init);
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
// the secret key in production. The sandbox honours it only from the app's own
// server code, never from a browser.
export async function sandboxServiceToken(): Promise<string> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    const jwt = await import("@/demo/sandbox/jwt");
    return jwt.serviceRoleKey();
  }
  throw new Error("The demo sandbox is not part of this build");
}
