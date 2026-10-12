// Emulates the Supabase Auth (GoTrue) endpoints this app calls, against the
// sandbox's own auth.users table. Nothing is ever emailed: confirmation is
// immediate, and "send a link / code" requests succeed without sending.
import { randomUUID } from "node:crypto";
import { lit, runAsSystem, SandboxError } from "./database.ts";
import { callerFrom, signToken } from "./jwt.ts";
import type { SandboxRequest } from "./rest.ts";

// One-time code accepted wherever the real system would email a 6-digit code.
export const DEMO_EMAIL_CODE = "424242";
const SESSION_SECONDS = 7 * 24 * 3600;

type UserRow = {
  id: string; email: string; email_confirmed_at: string | null; last_sign_in_at: string | null;
  raw_app_meta_data: Record<string, unknown>; raw_user_meta_data: Record<string, unknown>; created_at: string; updated_at: string;
};

const USER_COLUMNS = "id, email, email_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at";

function json(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: body === null ? {} : { "content-type": "application/json" } });
}

function authError(status: number, code: string, message: string) {
  return json({ code: status, error_code: code, msg: message }, status);
}

function publicUser(row: UserRow) {
  return {
    id: row.id, aud: "authenticated", role: "authenticated", email: row.email,
    email_confirmed_at: row.email_confirmed_at, confirmed_at: row.email_confirmed_at, last_sign_in_at: row.last_sign_in_at,
    app_metadata: row.raw_app_meta_data, user_metadata: row.raw_user_meta_data,
    identities: [{ id: row.id, identity_id: row.id, user_id: row.id, provider: "email", identity_data: { email: row.email, sub: row.id }, created_at: row.created_at, updated_at: row.updated_at, last_sign_in_at: row.last_sign_in_at }],
    factors: [], created_at: row.created_at, updated_at: row.updated_at, is_anonymous: false,
  };
}

async function one(sql: string): Promise<UserRow | null> {
  return runAsSystem(async (tx) => {
    const found = (await tx.query<{ body: string | null }>(`with _u as (${sql}) select row_to_json(_u)::text as body from _u limit 1`)).rows[0]?.body;
    return found ? (JSON.parse(found) as UserRow) : null;
  });
}

const userById = (id: string) => one(`select ${USER_COLUMNS} from auth.users where id = ${lit(id)}`);

// Refresh tokens live in memory: a server restart signs everyone out, and the
// demo sign-in is one click.
const KEY = Symbol.for("42mm.demo.sessions");
const holder = globalThis as unknown as Record<symbol, Map<string, { userId: string; sessionId: string; method: string }> | undefined>;
const refreshTokens = (holder[KEY] ??= new Map());

function session(user: UserRow, method: string, sessionId: string = randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signToken({
    sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", aal: "aal1", session_id: sessionId,
    amr: [{ method, timestamp: now }], app_metadata: user.raw_app_meta_data, user_metadata: user.raw_user_meta_data, is_anonymous: false,
  }, SESSION_SECONDS);
  const refreshToken = randomUUID().replace(/-/g, "");
  refreshTokens.set(refreshToken, { userId: user.id, sessionId, method });
  return { access_token: accessToken, token_type: "bearer", expires_in: SESSION_SECONDS, expires_at: now + SESSION_SECONDS, refresh_token: refreshToken, user: publicUser(user) };
}

async function signedIn(user: UserRow, method: string) {
  // Updating last_sign_in_at fires the sign-in audit trigger, as in production.
  const fresh = await one(`update auth.users set last_sign_in_at = now(), updated_at = now() where id = ${lit(user.id)} returning ${USER_COLUMNS}`);
  return json(session(fresh ?? user, method));
}

function body(request: SandboxRequest): Record<string, unknown> {
  if (!request.body?.byteLength) return {};
  try {
    const parsed = JSON.parse(Buffer.from(request.body).toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

async function currentUser(request: SandboxRequest): Promise<UserRow | null> {
  const caller = callerFrom(request.headers);
  if (caller.role !== "authenticated") return null;
  return userById(String(caller.claims?.sub));
}

export async function handleAuth(request: SandboxRequest, path: string): Promise<Response> {
  const route = path.replace(/^\/+|\/+$/g, "");
  const { method } = request;
  const input = method === "GET" ? {} : body(request);

  if (route === "token" && method === "POST") {
    const grant = request.url.searchParams.get("grant_type");
    if (grant === "password") {
      const email = text(input.email).toLowerCase();
      const password = typeof input.password === "string" ? input.password : "";
      const user = await one(`select ${USER_COLUMNS} from auth.users where lower(email) = ${lit(email)}
        and encrypted_password is not null and encrypted_password = crypt(${lit(password)}, encrypted_password)`);
      if (!user) return authError(400, "invalid_credentials", "Invalid login credentials");
      if (!user.email_confirmed_at) return authError(400, "email_not_confirmed", "Email not confirmed");
      return signedIn(user, "password");
    }
    if (grant === "refresh_token") {
      const known = refreshTokens.get(text(input.refresh_token));
      const user = known ? await userById(known.userId) : null;
      if (!known || !user) return authError(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      refreshTokens.delete(text(input.refresh_token));
      return json(session(user, known.method, known.sessionId));
    }
    // PKCE code exchange belongs to Google sign-in and emailed links, which the demo does not send.
    return authError(400, "flow_state_not_found", "This sign-in method is switched off in demo mode");
  }

  if (route === "user" && method === "GET") {
    const user = await currentUser(request);
    return user ? json(publicUser(user)) : authError(403, "bad_jwt", "invalid claim: missing sub claim");
  }

  if (route === "user" && method === "PUT") {
    const user = await currentUser(request);
    if (!user) return authError(403, "bad_jwt", "invalid claim: missing sub claim");
    const updates = ["updated_at = now()"];
    if (typeof input.password === "string") {
      if (input.password.length < 8) return authError(422, "weak_password", "Password should be at least 8 characters.");
      updates.push(`encrypted_password = crypt(${lit(input.password)}, gen_salt('bf', 6))`);
    }
    if (input.data && typeof input.data === "object") updates.push(`raw_user_meta_data = raw_user_meta_data || ${lit(input.data)}::jsonb`);
    const updated = await one(`update auth.users set ${updates.join(", ")} where id = ${lit(user.id)} returning ${USER_COLUMNS}`);
    return json(publicUser(updated ?? user));
  }

  if (route === "logout" && method === "POST") {
    const caller = callerFrom(request.headers);
    for (const [token, known] of refreshTokens) if (known.userId === caller.claims?.sub) refreshTokens.delete(token);
    return json(null, 204);
  }

  if (route === "signup" && method === "POST") {
    const email = text(input.email).toLowerCase();
    const password = typeof input.password === "string" ? input.password : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authError(422, "validation_failed", "Unable to validate email address: invalid format");
    if (password.length < 8) return authError(422, "weak_password", "Password should be at least 8 characters.");
    const existing = await one(`select ${USER_COLUMNS} from auth.users where lower(email) = ${lit(email)}`);
    // Same as Supabase: an existing address gets a look-alike user with no identities.
    if (existing) return json({ ...publicUser(existing), id: randomUUID(), identities: [] });
    const data = input.data && typeof input.data === "object" ? input.data : {};
    // Two steps, like a real confirmation: the membership binds on the email_confirmed_at update.
    await one(`insert into auth.users (email, encrypted_password, raw_user_meta_data)
      values (${lit(email)}, crypt(${lit(password)}, gen_salt('bf', 6)), ${lit(data)}::jsonb) returning ${USER_COLUMNS}`);
    const created = await one(`update auth.users set email_confirmed_at = now() where lower(email) = ${lit(email)} returning ${USER_COLUMNS}`);
    return json(publicUser(created!));
  }

  // "Email me a link / code" and "reset my password": accepted, nothing is sent.
  if ((route === "otp" || route === "recover" || route === "resend" || route === "magiclink") && method === "POST") return json({});

  if (route === "verify" && method === "POST") {
    const email = text(input.email).toLowerCase();
    if (!email || text(input.token) !== DEMO_EMAIL_CODE) return authError(403, "otp_expired", "Token has expired or is invalid");
    const user = await one(`select ${USER_COLUMNS} from auth.users where lower(email) = ${lit(email)}`);
    if (!user) return authError(403, "otp_expired", "Token has expired or is invalid");
    return signedIn(user, "otp");
  }

  // Google sign-in: send the browser back with a plain explanation.
  if (route === "authorize" && method === "GET") {
    return new Response(null, { status: 302, headers: { location: "/login?error=demo_google" } });
  }

  if (route.startsWith("factors")) return authError(422, "mfa_enroll_not_enabled", "Authenticator apps are switched off in demo mode");

  if (route === "settings") return json({ external: { email: true, google: false }, disable_signup: false, mailer_autoconfirm: true });

  throw new SandboxError("demo_auth_unsupported", `Auth endpoint not available in demo mode: ${method} /${route}`, 404);
}
