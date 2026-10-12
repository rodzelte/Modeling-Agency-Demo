// Serverless hosting (Vercel) for demo mode.
//
// On a long-running server every part of the app shares one process, so the
// sandbox is simply called in-process. A serverless host splits the app into
// several functions that share no memory. There, the sandbox lives in exactly
// one function (the bridge route, /api/demo/supabase/*) and every other function
// reaches it over the site's own address. Data is then consistent for as long as
// the host keeps that one function instance alive; when it is recycled, the demo
// starts again from the original sample data. See docs/demo-mode.md.
import { DEMO_BRIDGE_PATH, DEMO_SANDBOX_URL } from "../lib/demo.ts";

// DEMO_SPLIT=1 reproduces the serverless layout on a local server, for testing.
export function splitMode(): boolean {
  return process.env.VERCEL === "1" || process.env.DEMO_SPLIT === "1";
}

// Shared by every function of one deployment (generated at build time in
// next.config.ts, never sent to a browser). It marks a request as coming from
// the app's own server code, which may act as the service role and may ask the
// bridge to reset or report. It protects nothing but sample data.
export function internalSecret(): string {
  return process.env.DEMO_INTERNAL_SECRET ?? "";
}

export const INTERNAL_HEADER = "x-demo-internal";

// The site's own address, as reachable from inside a function.
export function bridgeOrigin(): string {
  if (process.env.VERCEL === "1") {
    // The production domain is not behind Vercel's deployment protection;
    // per-deployment addresses are, so they are the fallback only.
    const host = process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "";
    return `https://${host}`;
  }
  return `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

// This site's own host names: calls to them are not "outbound".
export function ownHosts(): string[] {
  return [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter((host): host is string => Boolean(host));
}

const NATIVE = Symbol.for("42mm.demo.nativeFetch");
// The server's real fetch, kept before the outbound block replaces it (boot.ts).
export function nativeFetch(): typeof fetch {
  const scope = globalThis as unknown as Record<symbol, typeof fetch | undefined>;
  return (scope[NATIVE] ??= globalThis.fetch.bind(globalThis));
}

function internalHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  merged.set(INTERNAL_HEADER, internalSecret());
  // Lets a protected preview deployment call itself, when the project has a bypass secret.
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) merged.set("x-vercel-protection-bypass", process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  return merged;
}

// A serverless host starts extra copies of a function when many requests reach
// it at once, and each copy would have its own sandbox. Two habits keep the
// bridge to one copy in practice: after a quiet spell only one request goes
// first (it wakes the sandbox while the others wait), and never more than a few
// requests are in flight from this function at a time.
const TRAFFIC = Symbol.for("42mm.demo.traffic");
type Traffic = { lastAnswer: number; leader: Promise<unknown> | null; active: number; waiting: (() => void)[] };
const QUIET_MS = 45_000;
const MAX_IN_FLIGHT = 3;

function traffic(): Traffic {
  const scope = globalThis as unknown as Record<symbol, Traffic | undefined>;
  return (scope[TRAFFIC] ??= { lastAnswer: 0, leader: null, active: 0, waiting: [] });
}

async function send(url: string, init: RequestInit): Promise<Response> {
  const state = traffic();
  if (Date.now() - state.lastAnswer > QUIET_MS) {
    state.leader ??= nativeFetch()(`${bridgeOrigin()}${DEMO_BRIDGE_PATH}/internal/status`, { method: "POST", headers: internalHeaders({ "content-type": "application/json" }), body: "{}", cache: "no-store" })
      .then((response) => { if (response.ok) state.lastAnswer = Date.now(); return response.arrayBuffer(); })
      .catch(() => undefined)
      .finally(() => { state.leader = null; });
    await state.leader;
  }
  if (state.active >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => state.waiting.push(resolve));
  state.active += 1;
  try {
    const response = await nativeFetch()(url, init);
    state.lastAnswer = Date.now();
    return response;
  } finally {
    state.active -= 1;
    state.waiting.shift()?.();
  }
}

// Sends a Supabase-style request (addressed to the sandbox URL or to the bridge
// path) to the bridge function over HTTP, marked as internal.
export async function remoteFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request && !init ? input : new Request(typeof input === "string" && input.startsWith("/") ? `${DEMO_SANDBOX_URL}${input.slice(DEMO_BRIDGE_PATH.length)}` : input, init);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  return send(`${bridgeOrigin()}${DEMO_BRIDGE_PATH}${url.pathname}${url.search}`, { method, headers: internalHeaders(request.headers), body, cache: "no-store" });
}

// Asks the bridge function to do something only it can do (it holds the sandbox).
export async function remoteInternal<T>(operation: "reset" | "status" | "sql", payload: unknown = {}): Promise<T> {
  const response = await send(`${bridgeOrigin()}${DEMO_BRIDGE_PATH}/internal/${operation}`, {
    method: "POST", headers: internalHeaders({ "content-type": "application/json" }), body: JSON.stringify(payload), cache: "no-store",
  });
  if (!response.ok) throw new Error(`demo sandbox ${operation} failed with ${response.status}`);
  return (await response.json()) as T;
}
