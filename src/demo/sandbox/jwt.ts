// HS256 tokens for sandbox sessions and signed file links. The signing secret is
// generated per server boot (database.ts): these tokens mean nothing outside
// this process and are unrelated to any Supabase project's keys.
import { createHmac, timingSafeEqual } from "node:crypto";
import { sandboxSecret, type Caller } from "./database.ts";

// Fixed, non-secret placeholders: the sandbox ignores the API key, exactly one
// "project" exists, and the anon role has no session.
export const DEMO_ANON_KEY = "demo-anon-key";

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const sign = (data: string) => createHmac("sha256", sandboxSecret()).update(data).digest("base64url");

export function signToken(payload: Record<string, unknown>, expiresInSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify({ iat: now, exp: now + expiresInSeconds, ...payload }))}`;
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  const expected = Buffer.from(sign(`${header}.${payload}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof claims.exp !== "number" || claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

// Server-side integrations (the GHL engine) get a service_role token; it is only
// honoured for in-process calls, never over the HTTP bridge (fetch.ts).
export function serviceRoleKey() {
  return signToken({ role: "service_role", iss: "demo-sandbox" }, 10 * 365 * 24 * 3600);
}

// Who is calling, from the request headers supabase-js sends. No token, the anon
// key, or anything that does not verify is the anonymous role.
export function callerFrom(headers: Headers): Caller & { token: string | null } {
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!bearer || bearer === DEMO_ANON_KEY) return { role: "anon", claims: null, token: null };
  const claims = verifyToken(bearer);
  if (!claims) return { role: "anon", claims: null, token: null };
  if (claims.role === "service_role") return { role: "service_role", claims, token: bearer };
  if (claims.role === "authenticated" && typeof claims.sub === "string") return { role: "authenticated", claims, token: bearer };
  return { role: "anon", claims: null, token: null };
}
