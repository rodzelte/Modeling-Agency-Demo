import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

// Shared-secret checks for machine callers. Constant-time comparison of SHA-256
// digests (equal length, no early exit); secrets shorter than 24 characters are
// treated as not configured. Secrets are accepted from headers only, never URLs.
function matches(provided: string | null | undefined, expected: string | undefined) {
  if (!expected || expected.length < 24 || !provided) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

export const webhookSecretMatches = (provided: string | null | undefined) => matches(provided, process.env.GHL_WEBHOOK_SECRET);

// Scheduled reconciliation: Vercel Cron and the GitHub Actions schedule send
// "Authorization: Bearer <CRON_SECRET>".
export function cronAuthorized(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  return matches(bearer, process.env.CRON_SECRET);
}

export function headerSecret(request: Request) {
  return request.headers.get("x-webhook-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}
