import { createBrowserClient } from "@supabase/ssr";
import { DEMO_ANON_KEY, DEMO_BRIDGE_PATH, DEMO_SANDBOX_URL, withDemoFileUrls } from "@/lib/demo";

// Browser client: publishable key only, so every request is subject to RLS.
// NEXT_PUBLIC_* values must be referenced literally for Next.js to inline them.
// In demo mode the browser talks only to this site's own sandbox bridge.
export const createClient = () =>
  process.env.NEXT_PUBLIC_DEMO_MODE === "true"
    ? withDemoFileUrls(createBrowserClient(typeof window === "undefined" ? DEMO_SANDBOX_URL : `${window.location.origin}${DEMO_BRIDGE_PATH}`, DEMO_ANON_KEY))
    : createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    );
