import "server-only";
import { log } from "@/lib/log";

// Server-side GoHighLevel API v2 client (Private Integration token).
// * The token is read from the environment here only and never leaves the server.
// * Requests are paced by GHL's rate-limit headers (100 per 10 s burst, 200k/day),
//   retried with exponential backoff and jitter on 429 and 5xx, and time out.
// Endpoints used are listed in docs/ghl-integration.md with their scopes.

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

export class GhlError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// Demo mode never contacts GoHighLevel: requests are answered by a stand-in built
// from the sandbox's sample CRM data (src/demo/integrations/ghl.ts).
const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export function ghlConfigured() {
  if (DEMO) return true;
  return Boolean(process.env.GHL_API_TOKEN && process.env.GHL_LOCATION_ID);
}

export function ghlLocationId() {
  if (DEMO) return "demo-location";
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new GhlError("GHL_LOCATION_ID is not set", 0);
  return id;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let pausedUntil = 0;

export async function ghlRequest<T>(method: "GET" | "POST" | "PUT", path: string, options: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    const { demoGhlRequest } = await import("@/demo/integrations/ghl");
    try {
      return await demoGhlRequest<T>(method, path, options);
    } catch (error) {
      throw new GhlError(error instanceof Error ? error.message : String(error), (error as { status?: number }).status ?? 0);
    }
  }
  const token = process.env.GHL_API_TOKEN;
  if (!token) throw new GhlError("GHL_API_TOKEN is not set", 0);
  const url = new URL(path, API);
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));

  for (let attempt = 0; ; attempt += 1) {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await sleep(wait);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
    } catch (error) {
      if (attempt >= 4) throw new GhlError(`GHL ${method} ${url.pathname} failed: ${error instanceof Error ? error.message : String(error)}`, 0);
      await sleep(backoff(attempt));
      continue;
    }
    // Slow down before the burst allowance runs out.
    const remaining = Number(response.headers.get("x-ratelimit-remaining") ?? 100);
    if (remaining < 5) pausedUntil = Math.max(pausedUntil, Date.now() + Number(response.headers.get("x-ratelimit-interval-milliseconds") ?? 10_000));

    if (response.ok) return (await response.json()) as T;
    const retryable = response.status === 429 || response.status >= 500;
    const text = (await response.text()).slice(0, 300);
    if (!retryable || attempt >= 5) {
      // Never include the token or full URLs with personal data in errors.
      throw new GhlError(`GHL ${method} ${url.pathname} failed with ${response.status}: ${text.replace(/pit-[a-z0-9-]+/gi, "pit-***")}`, response.status);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
    log.warn("ghl", "rate limited or server error, retrying", { status: response.status, attempt, delay });
    await sleep(delay);
  }
}

const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------
export type GhlCustomFieldValue = { id: string; value?: unknown; field_value?: unknown };
export type GhlContact = {
  id: string; firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null; dateOfBirth?: string | null;
  type?: string | null; source?: string | null; tags?: string[]; assignedTo?: string | null; address1?: string | null; city?: string | null;
  state?: string | null; postalCode?: string | null; country?: string | null; dateAdded?: string | null; dateUpdated?: string | null;
  customFields?: GhlCustomFieldValue[]; searchAfter?: unknown[];
};
export type GhlOpportunity = {
  id: string; name?: string | null; monetaryValue?: number | null; pipelineId: string; pipelineStageId?: string | null; status?: string | null;
  source?: string | null; assignedTo?: string | null; contactId: string; createdAt?: string | null; updatedAt?: string | null;
  lastStageChangeAt?: string | null; lastStatusChangeAt?: string | null; customFields?: GhlCustomFieldValue[];
};
export type GhlPipeline = { id: string; name: string; stages?: { id: string; name: string; position?: number }[] };
export type GhlFieldDefinition = { id: string; name: string; fieldKey?: string; dataType?: string; model?: string; picklistOptions?: unknown };

export const ghl = {
  pipelines: async () => (await ghlRequest<{ pipelines?: GhlPipeline[] }>("GET", "/opportunities/pipelines", { query: { locationId: ghlLocationId() } })).pipelines ?? [],
  // model=all returns contact and opportunity fields plus Business and custom objects.
  customFields: async () => (await ghlRequest<{ customFields?: GhlFieldDefinition[] }>("GET", `/locations/${ghlLocationId()}/customFields`, { query: { model: "all" } })).customFields ?? [],
  customValues: async () => (await ghlRequest<{ customValues?: { id: string; name: string; fieldKey?: string; value?: string }[] }>("GET", `/locations/${ghlLocationId()}/customValues`)).customValues ?? [],
  users: async () => (await ghlRequest<{ users?: { id: string; name?: string; firstName?: string; lastName?: string; email?: string; roles?: { role?: string } }[] }>("GET", "/users/", { query: { locationId: ghlLocationId() } })).users ?? [],
  // Full record: the only response that includes FILE_UPLOAD (photo) values.
  contact: async (id: string) => (await ghlRequest<{ contact?: GhlContact }>("GET", `/contacts/${encodeURIComponent(id)}`)).contact ?? null,
  // Page of contacts, newest-updated first. Pass the last contact's searchAfter to continue.
  searchContacts: (searchAfter?: unknown[]) => ghlRequest<{ contacts?: GhlContact[]; total?: number }>("POST", "/contacts/search", {
    body: { locationId: ghlLocationId(), pageLimit: 100, sort: [{ field: "dateUpdated", direction: "desc" }], ...(searchAfter ? { searchAfter } : { page: 1 }) },
  }),
  opportunitiesPage: (page: number, contactId?: string) => ghlRequest<{ opportunities?: GhlOpportunity[]; meta?: { total?: number } }>("GET", "/opportunities/search", {
    query: { location_id: ghlLocationId(), limit: 100, page, contact_id: contactId },
  }),
  updateContact: (id: string, body: Record<string, unknown>) => ghlRequest<{ contact?: GhlContact }>("PUT", `/contacts/${encodeURIComponent(id)}`, { body }),
};

export function isNotFound(error: unknown) {
  return error instanceof GhlError && (error.status === 404 || error.status === 400 && /not found/i.test(error.message));
}
