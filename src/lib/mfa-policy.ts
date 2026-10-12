// When a role that requires two-step sign-in may skip the authenticator code.
// Pure: no Supabase or Next.js imports, so it is unit-tested directly.
//
// Owner decision: signing in with Google counts as the second step, because the
// Google account has its own verification. A Google sign-in is trusted for
// GOOGLE_SIGN_IN_TRUST_DAYS; after that (or for password and email-link sign-ins)
// the person either signs in with Google again or enters an authenticator code.
export const GOOGLE_SIGN_IN_TRUST_DAYS = 30;

type AmrEntry = { method: string; timestamp?: number } | string;

export function recentGoogleSignIn(
  methods: readonly AmrEntry[] | null | undefined,
  providers: readonly string[] | null | undefined,
  nowSeconds = Date.now() / 1000,
) {
  if (!providers?.includes("google")) return false;
  const oauth = (methods ?? []).filter((entry): entry is { method: string; timestamp: number } =>
    typeof entry === "object" && entry.method === "oauth" && typeof entry.timestamp === "number");
  const latest = Math.max(...oauth.map((entry) => entry.timestamp), -Infinity);
  return latest <= nowSeconds + 300 && nowSeconds - latest <= GOOGLE_SIGN_IN_TRUST_DAYS * 86400;
}
