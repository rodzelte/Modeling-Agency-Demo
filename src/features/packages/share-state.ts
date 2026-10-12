// Pure (client-safe) link state helper; token hashing lives in share.ts (server).
export type LinkState = "none" | "live" | "expired" | "revoked";

// Current state of a package's share link.
export function linkState(pkg: { has_link?: boolean; shared_at?: string | null; expires_at: string | null; revoked_at: string | null }, now = Date.now()): LinkState {
  if (pkg.revoked_at) return "revoked";
  if (!(pkg.has_link ?? Boolean(pkg.shared_at))) return "none";
  return pkg.expires_at && Date.parse(pkg.expires_at) < now ? "expired" : "live";
}
