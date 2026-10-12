// Demo housekeeping that needs the sandbox itself (not a user's session): the
// GoHighLevel stand-in reading the sample CRM data, restoring a sample
// account's password, reset, and status. On a single server these run
// in-process; on a serverless host they are forwarded to the one function that
// holds the sandbox (remote.ts). The sandbox modules are loaded only when they
// are actually used here, so other functions stay light.
import { remoteInternal, splitMode } from "./remote.ts";

export type Row = Record<string, unknown>;
export type SandboxStatus = { instance: string; seededAt: string; resets: number; files: number; startedAt: string };

// Identifies this copy of the sandbox. If /api/demo/status shows the value
// changing between refreshes, the host is running more than one copy.
const STARTED = Symbol.for("42mm.demo.started");
const copies = globalThis as unknown as Record<symbol, { instance: string; startedAt: string } | undefined>;
const thisCopy = () => (copies[STARTED] ??= { instance: crypto.randomUUID().slice(0, 8), startedAt: new Date().toISOString() });

// Runs one statement as the sandbox's superuser and returns its rows. Data-changing
// statements need a RETURNING clause.
export async function localRows(sql: string): Promise<Row[]> {
  const [{ getSandbox, runAsSystem }, { seedDemo }] = await Promise.all([import("./sandbox/database.ts"), import("./seed/index.ts")]);
  await getSandbox(seedDemo);
  return runAsSystem(async (tx) => JSON.parse((await tx.query<{ body: string }>(`with _r as (${sql}) select coalesce(json_agg(row_to_json(_r)), '[]')::text as body from _r`)).rows[0].body) as Row[]);
}

export async function localReset(): Promise<{ resets: number }> {
  const [{ getSandbox, resetSandbox }, { seedDemo }] = await Promise.all([import("./sandbox/database.ts"), import("./seed/index.ts")]);
  await getSandbox(seedDemo);
  return { resets: (await resetSandbox()).resets };
}

export async function localStatus(): Promise<SandboxStatus> {
  const [{ getSandbox }, { seedDemo }] = await Promise.all([import("./sandbox/database.ts"), import("./seed/index.ts")]);
  const sandbox = await getSandbox(seedDemo);
  return { ...thisCopy(), seededAt: new Date(sandbox.seededAt).toISOString(), resets: sandbox.resets, files: sandbox.files.size };
}

export const systemRows = (sql: string): Promise<Row[]> => (splitMode() ? remoteInternal<{ rows: Row[] }>("sql", { sql }).then((result) => result.rows) : localRows(sql));
export const resetDemo = (): Promise<{ resets: number }> => (splitMode() ? remoteInternal<{ resets: number }>("reset") : localReset());
export const sandboxStatus = (): Promise<SandboxStatus> => (splitMode() ? remoteInternal<SandboxStatus>("status") : localStatus());

// The bridge function's side of remoteInternal().
export async function handleInternal(operation: string, payload: unknown): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (operation === "reset") return json(await localReset());
  if (operation === "status") return json(await localStatus());
  if (operation === "sql") {
    const sql = (payload as { sql?: unknown } | null)?.sql;
    if (typeof sql !== "string") return json({ error: "Invalid request" }, 400);
    return json({ rows: await localRows(sql) });
  }
  return json({ error: "Not found" }, 404);
}
