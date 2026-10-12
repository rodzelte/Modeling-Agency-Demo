// Demo mode (src/lib/demo.ts) shows a fictional inbox and keeps "Join us" on
// this site, so a demo visitor can never email the agency or submit a real
// application. The literal comparison lets production builds drop the branch.
const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

// Public agency details used across the website.
export const CONTACT_EMAIL = DEMO ? "hello@northlight-demo.example" : "lenny@42modelmanagement.com";

// "Join us" stays on GoHighLevel; submissions flow back via /api/integrations/ghl.
export const JOIN_URL = DEMO ? "/demo/join" : "https://funnel.modelluxemedia.com/registration-form";

// The agency's home time zone: calendar days and exports are bucketed in it.
export const AGENCY_TIME_ZONE = "America/Chicago";

// The address the visitor is using, for links we hand out when
// NEXT_PUBLIC_SITE_URL is not set. A demo deployment sits behind its host's proxy
// with no site URL configured, and request.url can carry the server's internal
// address there, so demo mode reads the proxy's forwarded headers instead.
export function requestOrigin(request: Request): string {
  const fallback = new URL(request.url).origin;
  if (!DEMO) return fallback;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
  if (!/^[a-z0-9.-]+(:[0-9]+)?$/i.test(host)) return fallback;
  const forwarded = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  return `${forwarded === "https" || forwarded === "http" ? forwarded : new URL(request.url).protocol.replace(":", "")}://${host}`;
}

// The site's public origin from NEXT_PUBLIC_SITE_URL, e.g. "https://www.example.com".
// Tolerates a missing scheme, a trailing slash or a path; returns null when unset
// or not a valid http(s) address, so a bad setting can never break the build.
export function siteOrigin(value = process.env.NEXT_PUBLIC_SITE_URL): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}
