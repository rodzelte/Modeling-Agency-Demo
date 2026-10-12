// Demo-mode server start-up (called from src/instrumentation.ts, Node runtime):
//   1. forget any real credentials the environment happens to hold,
//   2. block every outbound request from this server,
//   3. start the sandbox so the first visitor does not wait for it.
import { DEMO_BRIDGE_PATH, DEMO_SANDBOX_URL } from "../lib/demo.ts";
import { getSandbox } from "./sandbox/database.ts";
import { sandboxFetch } from "./sandbox/fetch.ts";
import { seedDemo } from "./seed/index.ts";

// Settings that point at real services (the Supabase project, GoHighLevel,
// scheduled jobs, alerting, databases, payments, mail). Demo code never reads
// them; removing them from the process makes that a fact rather than a habit.
// Matched by name pattern, so a setting added later is covered too.
const PRODUCTION_SETTING = /^(NEXT_PUBLIC_SUPABASE_|SUPABASE_|GHL_|STRIPE_|SMTP_|RESEND_|SENDGRID_|TWILIO_|POSTGRES_|PG(HOST|PORT|USER|PASSWORD|DATABASE)$|DATABASE_URL$|CRON_SECRET$|ERROR_ALERT_WEBHOOK_URL$|IMPORT_TARGET_URL$)/;

export function productionSettingsPresent(): string[] {
  return Object.keys(process.env).filter((name) => PRODUCTION_SETTING.test(name) && Boolean(process.env[name])).sort();
}

const GUARD = Symbol.for("42mm.demo.egress");
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

type Guarded = typeof globalThis & { [GUARD]?: { blocked: { host: string; at: string }[] } };

// Replaces the server's global fetch. Sandbox addresses are answered in-process,
// this machine's own addresses pass, and everything else is refused and logged:
// in demo mode no email, CRM, webhook or storage provider can be reached.
function guardEgress() {
  const scope = globalThis as Guarded;
  if (scope[GUARD]) return;
  const state = { blocked: [] as { host: string; at: string }[] };
  scope[GUARD] = state;
  const passthrough = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (raw.startsWith(`${DEMO_BRIDGE_PATH}/`)) return sandboxFetch(`${DEMO_SANDBOX_URL}${raw.slice(DEMO_BRIDGE_PATH.length)}`, init, { external: true });
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return passthrough(input, init);
    }
    if (url.origin === DEMO_SANDBOX_URL) return sandboxFetch(input, init, { external: true });
    // Only http(s) leaves the machine; data: and blob: URLs are in-memory reads.
    if (url.protocol !== "http:" && url.protocol !== "https:") return passthrough(input, init);
    if (LOOPBACK.has(url.hostname)) return passthrough(input, init);
    state.blocked.push({ host: url.host, at: new Date().toISOString() });
    if (state.blocked.length > 200) state.blocked.shift();
    console.warn(JSON.stringify({ level: "warn", scope: "demo", message: "outbound request blocked in demo mode", host: url.host, at: new Date().toISOString() }));
    throw new TypeError(`Demo mode: outbound request to ${url.host} was blocked`);
  }) as typeof fetch;
}

// Hosts this server tried to reach since it started (always refused).
export function blockedRequests(): { host: string; at: string }[] {
  return [...((globalThis as Guarded)[GUARD]?.blocked ?? [])];
}

export function startDemo() {
  for (const name of Object.keys(process.env)) if (PRODUCTION_SETTING.test(name)) delete process.env[name];
  guardEgress();
  const started = Date.now();
  getSandbox(seedDemo)
    .then((sandbox) => console.info(JSON.stringify({ level: "info", scope: "demo", message: "sandbox ready", files: sandbox.files.size, ms: Date.now() - started, at: new Date().toISOString() })))
    .catch((error: unknown) => console.error(JSON.stringify({ level: "error", scope: "demo", message: "sandbox failed to start", error: error instanceof Error ? error.message : String(error), at: new Date().toISOString() })));
}
