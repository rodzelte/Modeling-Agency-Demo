import type { SupabaseClient } from "@supabase/supabase-js";

// Demo mode: the whole app runs against an in-memory sandbox (src/demo) instead
// of a Supabase project. It is chosen at build time (next.config.ts always
// defines NEXT_PUBLIC_DEMO_MODE as "true" or "false"), so a production build
// contains none of the demo branches and a demo build contains no route to
// production. The comparison must stay literal for the bundler to drop them.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

// supabase-js needs an absolute URL. `.invalid` can never resolve (RFC 2606):
// if a request ever escaped the sandbox fetch it would fail, not reach anyone.
export const DEMO_SANDBOX_URL = "http://sandbox.demo.invalid";
// Same-origin route that lets the browser reach the sandbox (files, sign-in).
export const DEMO_BRIDGE_PATH = "/api/demo/supabase";
// Placeholder, not a credential: the sandbox has no API keys.
export const DEMO_ANON_KEY = "demo-anon-key";

// Shown wherever the real site would name the agency's own inbox.
export const DEMO_CONTACT_EMAIL = "hello@northlight-demo.example";

const toBridge = (url: string) => {
  const at = url.indexOf("/storage/v1/");
  return at === -1 ? url : `${DEMO_BRIDGE_PATH}${url.slice(at)}`;
};

// File links from the sandbox are served by this site itself. Returning them as
// site-relative paths keeps every image working on whatever host the demo is
// opened from (localhost, a tunnel, a deployed address).
export function withDemoFileUrls<Client extends SupabaseClient>(client: Client): Client {
  const storage = client.storage;
  const from = storage.from.bind(storage);
  storage.from = (bucket: string) => {
    const api = from(bucket);
    const getPublicUrl = api.getPublicUrl.bind(api);
    const createSignedUrl = api.createSignedUrl.bind(api);
    const createSignedUrls = api.createSignedUrls.bind(api);
    api.getPublicUrl = ((...args: Parameters<typeof getPublicUrl>) => {
      const result = getPublicUrl(...args);
      return { data: { publicUrl: toBridge(result.data.publicUrl) } };
    }) as typeof api.getPublicUrl;
    api.createSignedUrl = (async (...args: Parameters<typeof createSignedUrl>) => {
      const result = await createSignedUrl(...args);
      return result.data ? { ...result, data: { ...result.data, signedUrl: toBridge(result.data.signedUrl) } } : result;
    }) as typeof api.createSignedUrl;
    api.createSignedUrls = (async (...args: Parameters<typeof createSignedUrls>) => {
      const result = await createSignedUrls(...args);
      return result.data ? { ...result, data: result.data.map((item) => ({ ...item, signedUrl: item.signedUrl ? toBridge(item.signedUrl) : item.signedUrl })) } : result;
    }) as typeof api.createSignedUrls;
    return api;
  };
  return client;
}
