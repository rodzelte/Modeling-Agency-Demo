// The sandbox's front door: a fetch() implementation handed to supabase-js in
// demo mode. Requests that would go to a Supabase project are answered here, in
// this process, from the sandbox database. Nothing is forwarded anywhere.
import { getSandbox, resetSandbox, SandboxError, type Caller } from "./database.ts";
import { callerFrom } from "./jwt.ts";
import { handleAuth } from "./auth.ts";
import { handleRest, type SandboxRequest } from "./rest.ts";
import { handleStorage } from "./storage.ts";
import { seedDemo } from "../seed/index.ts";

type Service = "rest" | "auth" | "storage";

// HTTP status for a Postgres error, following PostgREST's mapping.
function statusFor(code: string, caller: Caller): number {
  if (code === "42501") return caller.role === "anon" ? 401 : 403;
  if (code === "23505" || code === "23503") return 409;
  if (code === "42P01" || code === "42883") return 404;
  if (code.startsWith("08") || code.startsWith("53") || code.startsWith("XX")) return 500;
  return 400;
}

function failure(error: unknown, service: Service, caller: Caller): Response {
  const known = error as { code?: unknown; message?: unknown; detail?: unknown; details?: unknown; hint?: unknown; status?: unknown };
  const code = typeof known?.code === "string" ? known.code : "XX000";
  const message = typeof known?.message === "string" ? known.message : "Unexpected sandbox error";
  const status = error instanceof SandboxError ? error.status : /^[0-9A-Z]{5}$/.test(code) ? statusFor(code, caller) : 500;
  const headers = { "content-type": "application/json" };
  if (status >= 500) console.error(JSON.stringify({ level: "error", scope: "demo-sandbox", message, code, at: new Date().toISOString() }));
  if (service === "storage") {
    const label = code === "23505" ? "Duplicate" : code === "42501" ? "Unauthorized" : "Error";
    const text = code === "23505" ? "The resource already exists" : message;
    const http = code === "42501" ? 403 : status;
    return new Response(JSON.stringify({ statusCode: String(http), error: label, message: text }), { status: http, headers });
  }
  if (service === "auth") return new Response(JSON.stringify({ code: status, error_code: code, msg: message }), { status, headers });
  const details = typeof known?.detail === "string" ? known.detail : typeof known?.details === "string" ? known.details : null;
  return new Response(JSON.stringify({ code, details, hint: typeof known?.hint === "string" ? known.hint : null, message }), { status, headers });
}

// A demo left changed and then untouched for a while is put back to the original
// sample data before the next visitor's first request, so each prospect starts
// clean. DEMO_IDLE_RESET_MINUTES sets the wait (default 60); 0 switches it off.
const ACTIVITY = Symbol.for("42mm.demo.activity");
const activityStore = globalThis as unknown as Record<symbol, { last: number; changed: boolean } | undefined>;
const READ_ONLY_CALLS = /\/rpc\/(current_permissions|email_mfa_verified|portal_access|portal_profile|my_subscription|get_shared_package|talent_booking_conflicts)$/;

async function resetIfIdle(method: string, service: Service, path: string) {
  const state = (activityStore[ACTIVITY] ??= { last: Date.now(), changed: false });
  const minutes = Number(process.env.DEMO_IDLE_RESET_MINUTES ?? 60);
  const now = Date.now();
  if (state.changed && Number.isFinite(minutes) && minutes > 0 && now - state.last > minutes * 60_000) {
    state.changed = false;
    await resetSandbox();
    console.info(JSON.stringify({ level: "info", scope: "demo", message: "sandbox reset after an idle period", at: new Date().toISOString() }));
  }
  state.last = now;
  if (method !== "GET" && method !== "HEAD" && !(service === "rest" && READ_ONLY_CALLS.test(path))) state.changed = true;
}

// `external` is true for requests that arrived over HTTP (the browser bridge):
// those can never act as the service role, whatever token they present.
export async function sandboxFetch(input: RequestInfo | URL, init?: RequestInit, options: { external?: boolean } = {}): Promise<Response> {
  const request = input instanceof Request && !init ? input : new Request(input, init);
  const url = new URL(request.url);
  const match = /\/(rest|auth|storage)\/v1(\/.*)?$/.exec(url.pathname);
  if (!match) return new Response(JSON.stringify({ message: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
  const service = match[1] as Service;
  const path = match[2] ?? "";
  let caller: Caller = { role: "anon", claims: null };
  try {
    await getSandbox(seedDemo);
    const identified = callerFrom(request.headers);
    if (identified.role === "service_role" && options.external) {
      return new Response(JSON.stringify({ message: "Not allowed" }), { status: 401, headers: { "content-type": "application/json" } });
    }
    caller = { role: identified.role, claims: identified.claims };
    const method = request.method.toUpperCase();
    await resetIfIdle(method, service, path);
    const body = method === "GET" || method === "HEAD" ? null : new Uint8Array(await request.arrayBuffer());
    const sandboxRequest: SandboxRequest = { method, url, headers: request.headers, body };
    if (service === "rest") return await handleRest(sandboxRequest, caller, path);
    if (service === "auth") return await handleAuth(sandboxRequest, path);
    return await handleStorage(sandboxRequest, caller, path);
  } catch (error) {
    return failure(error, service, caller);
  }
}
