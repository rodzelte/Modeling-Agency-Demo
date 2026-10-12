// The demo sandbox database: an in-process Postgres (PGlite) that replays the
// real supabase/migrations, so RLS, triggers, views and functions behave exactly
// as they do in production. It lives in this server's memory only. Nothing here
// knows a production URL or key, so nothing here can reach production.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { BUCKETS_STUB, SUPABASE_STUB } from "./stub.ts";

export type StoredFile = { bytes: Uint8Array; contentType: string };
export type Seeder = (db: PGlite, files: Map<string, StoredFile>) => Promise<void>;
export type SandboxRole = "anon" | "authenticated" | "service_role";
export type Caller = { role: SandboxRole; claims: Record<string, unknown> | null };

export type Sandbox = {
  db: PGlite;
  // File bytes for the emulated Storage API, keyed "<bucket>/<object name>".
  files: Map<string, StoredFile>;
  seededAt: number;
  resets: number;
};

type State = {
  ready: Promise<Sandbox>;
  snapshot: Blob | null;
  seedFiles: Map<string, StoredFile>;
  seeder: Seeder | null;
  caches: Map<string, unknown>;
};

const KEY = Symbol.for("42mm.demo.sandbox");
const store = globalThis as unknown as Record<symbol, State | undefined>;

// The seed uses dates relative to "now"; after this long a reset rebuilds it
// from scratch so upcoming bookings stay upcoming.
const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function migrationsDir() {
  return join(process.cwd(), "supabase", "migrations");
}

async function build(state: State): Promise<Sandbox> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(migrationsDir()).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  for (const file of files) await db.exec(readFileSync(join(migrationsDir(), file), "utf8"));
  await db.exec(BUCKETS_STUB);
  const stored = new Map<string, StoredFile>();
  if (state.seeder) await state.seeder(db, stored);
  state.snapshot = await db.dumpDataDir("none");
  state.seedFiles = new Map(stored);
  return { db, files: stored, seededAt: Date.now(), resets: 0 };
}

function current(seeder?: Seeder): State {
  let state = store[KEY];
  if (!state) {
    state = { ready: null as unknown as Promise<Sandbox>, snapshot: null, seedFiles: new Map(), seeder: seeder ?? null, caches: new Map() };
    state.ready = build(state);
    // A failed boot must not poison every later request with the same rejection.
    state.ready.catch(() => { if (store[KEY] === state) store[KEY] = undefined; });
    store[KEY] = state;
  }
  return state;
}

// Boots the sandbox on first use. The seeder is only read on that first call.
export function getSandbox(seeder?: Seeder): Promise<Sandbox> {
  return current(seeder).ready;
}

// Small per-boot cache for catalog lookups (foreign keys, function signatures).
// The schema never changes after boot, so a reset keeps it.
export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const state = current();
  if (!state.caches.has(key)) state.caches.set(key, load());
  return state.caches.get(key) as Promise<T>;
}

// Restores the original sample data. Requests that arrive during the swap wait
// for it; the old database is closed once the new one is ready.
export async function resetSandbox(): Promise<Sandbox> {
  const state = current();
  const previous = await state.ready.catch(() => null);
  const next = (async () => {
    const stale = !previous || Date.now() - previous.seededAt > SNAPSHOT_MAX_AGE_MS;
    let sandbox: Sandbox;
    if (stale || !state.snapshot) {
      sandbox = await build(state);
    } else {
      const db = new PGlite({ loadDataDir: state.snapshot, extensions: { pgcrypto } });
      await db.waitReady;
      sandbox = { db, files: new Map(state.seedFiles), seededAt: previous.seededAt, resets: 0 };
    }
    sandbox.resets = (previous?.resets ?? 0) + 1;
    return sandbox;
  })();
  state.ready = next;
  const sandbox = await next;
  await previous?.db.close().catch(() => undefined);
  return sandbox;
}

// Runs statements the way PostgREST does for a caller: one transaction, as the
// anon / authenticated / service_role role, with the caller's JWT claims set.
export async function runAs<T>(caller: Caller, work: (tx: Transaction) => Promise<T>): Promise<T> {
  const sandbox = await getSandbox();
  return sandbox.db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [caller.claims ? JSON.stringify(caller.claims) : ""]);
    await tx.exec(`set local role ${caller.role}`);
    return work(tx);
  }) as Promise<T>;
}

// Superuser access for the emulated Auth and Storage services' own bookkeeping.
export async function runAsSystem<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  const sandbox = await getSandbox();
  return sandbox.db.transaction(work) as Promise<T>;
}

export { ident, lit, SandboxError } from "./sql.ts";
