import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { ghl, ghlConfigured } from "./client";
import { bump, chunks, discover, loadConfig, loadDashboard, pushContact, saveOpportunities, syncContact, writeDashboard, type SyncConfig, type SyncStats } from "./sync";

// Orchestration for the GHL sync. The only GHL module that creates the
// secret-key client; callers (webhook, cron and dashboard routes) authenticate
// first. Work is bounded by a deadline so it fits a serverless invocation, and
// everything resumes from the database (queue rows, run cursor) on the next call.

const MAX_ATTEMPTS = 8;
const CONCURRENCY = 4;
const contactIdPattern = /^[A-Za-z0-9]{8,64}$/;

export const isGhlId = (value: unknown): value is string => typeof value === "string" && contactIdPattern.test(value);

export async function enqueueContacts(ids: Iterable<string>, reason: string) {
  const rows = [...new Set(ids)].filter(isGhlId).map((external_id) => ({ kind: "contact", external_id, reason }));
  if (!rows.length) return 0;
  const db = createAdminSupabaseClient();
  let queued = 0;
  for (const batch of chunks(rows, 200)) {
    // One open job per contact: ids already queued are skipped in the database
    // (migration 033), so a webhook racing the hourly sync is not an error, and
    // a failed job that is queued again becomes due now.
    const { data, error } = await db.rpc("ghl_enqueue_jobs", { p_kind: "contact", p_ids: batch.map((row) => row.external_id), p_reason: reason });
    if (error) throw error;
    queued += Number(data ?? 0);
  }
  return queued;
}

export async function recordWebhook(event: string | null, contactId: string | null, opportunityId: string | null, outcome: string) {
  const db = createAdminSupabaseClient();
  await db.from("ghl_webhook_events").insert({ event: event?.slice(0, 80) ?? null, contact_id: contactId, opportunity_id: opportunityId, outcome: outcome.slice(0, 80) });
}

type Job = { id: string; kind: "contact" | "push_contact"; external_id: string; attempts: number };

// Processes due queue jobs until the deadline. Failures back off exponentially
// (2, 4, 8 ... minutes, capped at 6 hours) and become "dead" after 8 attempts.
export async function drainQueue(deadline: number, stats: SyncStats = {}, config?: SyncConfig) {
  const db = createAdminSupabaseClient();
  const cfg = config ?? (await loadConfig(db));
  while (Date.now() < deadline - 8_000) {
    const { data, error } = await db.rpc("ghl_claim_jobs", { p_limit: CONCURRENCY * 2 });
    if (error) throw error;
    const jobs = (data ?? []) as Job[];
    if (!jobs.length) break;
    for (const group of chunks(jobs, CONCURRENCY)) {
      await Promise.all(group.map(async (job) => {
        if (Date.now() > deadline - 5_000) {
          await db.from("ghl_sync_jobs").update({ status: "pending", attempts: job.attempts - 1, updated_at: new Date().toISOString() }).eq("id", job.id);
          return;
        }
        try {
          if (job.kind === "contact") await syncContact(db, job.external_id, cfg, stats);
          else await pushContact(db, job.external_id, cfg, stats);
          await db.from("ghl_sync_jobs").update({ status: "done", last_error: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
          bump(stats, "jobs_done");
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : String(failure);
          const dead = job.attempts >= MAX_ATTEMPTS;
          const delay = Math.min(6 * 60, 2 ** job.attempts) * 60_000;
          log.warn("ghl", "sync job failed", { job: job.id, kind: job.kind, attempts: job.attempts, dead, error: message.slice(0, 200) });
          await db.from("ghl_sync_jobs").update({
            status: dead ? "dead" : "failed", last_error: message.slice(0, 500), next_attempt_at: new Date(Date.now() + delay).toISOString(), updated_at: new Date().toISOString(),
          }).eq("id", job.id);
          bump(stats, dead ? "jobs_dead" : "jobs_failed");
        }
      }));
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Reconciliation: discovery → every opportunity → every contact (changed ones are
// queued for a full fetch) → drain the queue → mark what GHL no longer has.
// One run at a time; a run continues across invocations through its cursor.
// ---------------------------------------------------------------------------
type Cursor = { phase: "discovery" | "opportunities" | "contacts" | "jobs" | "cleanup"; page?: number; searchAfter?: unknown[]; full?: boolean };
type Run = { id: string; cursor: Cursor; stats: SyncStats; started_at: string };

// `continuation` marks a run calling itself to carry on: it must not be turned
// away by the overlap guard (its own previous call just saved a heartbeat).
export async function reconcile(trigger: "cron" | "dashboard" | "script", deadline: number, triggeredBy: string | null = null, continuation = false) {
  if (!ghlConfigured()) throw new Error("GHL_API_TOKEN and GHL_LOCATION_ID must be set on the server");
  const db = createAdminSupabaseClient();
  const { data: running } = await db.from("ghl_sync_runs").select("id,cursor,stats,started_at").eq("kind", "reconcile").eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle();
  let run = running as Run | null;
  if (run) {
    // A scheduled call while another invocation is working on it right now: leave it alone.
    const { data: fresh } = await db.from("ghl_sync_runs").select("heartbeat_at").eq("id", run.id).single();
    if (fresh && Date.now() - new Date(fresh.heartbeat_at).getTime() < 75_000 && trigger === "cron" && !continuation) return { runId: run.id, done: false, busy: true, stats: run.stats };
  } else {
    const { data, error } = await db.from("ghl_sync_runs").insert({ kind: "reconcile", trigger, triggered_by: triggeredBy, cursor: { phase: "discovery" } }).select("id,cursor,stats,started_at").single();
    if (error) throw error;
    run = data as Run;
  }
  const stats: SyncStats = { ...run.stats };
  let cursor: Cursor = { ...run.cursor };
  const save = async (extra: Record<string, unknown> = {}) => {
    await db.from("ghl_sync_runs").update({ cursor, stats, heartbeat_at: new Date().toISOString(), ...extra }).eq("id", run.id);
  };

  try {
    let config: SyncConfig | undefined;
    while (Date.now() < deadline - 8_000) {
      await save();
      if (cursor.phase === "discovery") {
        await discover(db, stats);
        cursor = { phase: "opportunities", page: 1 };
      } else if (cursor.phase === "opportunities") {
        const page = cursor.page ?? 1;
        const result = await ghl.opportunitiesPage(page);
        const items = result.opportunities ?? [];
        const changed = await saveOpportunities(db, items, stats);
        if (changed.size) bump(stats, "contacts_queued", await enqueueContacts(changed, "opportunity changed"));
        cursor = items.length < 100 ? { phase: "contacts" } : { phase: "opportunities", page: page + 1 };
      } else if (cursor.phase === "contacts") {
        const result = await ghl.searchContacts(cursor.searchAfter);
        const contacts = result.contacts ?? [];
        const ids = contacts.map((contact) => contact.id);
        const known = new Map(((await db.from("ghl_contacts").select("id,source_updated_at,full_fetched_at").in("id", ids)).data ?? []).map((row) => [row.id, row]));
        const stale = contacts.filter((contact) => {
          const row = known.get(contact.id);
          return !row?.full_fetched_at || (contact.dateUpdated && new Date(contact.dateUpdated) > new Date(row.source_updated_at ?? 0));
        }).map((contact) => contact.id);
        if (stale.length) bump(stats, "contacts_queued", await enqueueContacts(stale, "contact changed"));
        const seen = ids.filter((id) => known.has(id));
        if (seen.length) await db.from("ghl_contacts").update({ synced_at: new Date().toISOString() }).in("id", seen);
        bump(stats, "contacts_seen", contacts.length);
        const last = contacts.at(-1);
        cursor = contacts.length < 100 || !last?.searchAfter ? { phase: "jobs", full: true } : { phase: "contacts", searchAfter: last.searchAfter };
      } else if (cursor.phase === "jobs") {
        config ??= await loadConfig(db);
        await drainQueue(deadline, stats, config);
        const { count } = await db.from("ghl_sync_jobs").select("id", { count: "exact", head: true }).eq("status", "pending").lte("next_attempt_at", new Date().toISOString());
        if (count) continue; // out of time; the next invocation carries on
        cursor = { phase: "cleanup", full: cursor.full };
      } else {
        // A complete scan saw everything GHL still has; anything not seen was deleted there.
        if (cursor.full) {
          const removedAt = new Date().toISOString();
          const contacts = await db.from("ghl_contacts").update({ removed_at: removedAt }).lt("synced_at", run.started_at).is("removed_at", null).select("id");
          const opportunities = await db.from("ghl_opportunities").update({ removed_at: removedAt }).lt("synced_at", run.started_at).is("removed_at", null).select("id,contact_id");
          bump(stats, "contacts_removed", contacts.data?.length ?? 0);
          bump(stats, "opportunities_removed", opportunities.data?.length ?? 0);
          if (opportunities.data?.length) await enqueueContacts(opportunities.data.map((row) => row.contact_id), "opportunity removed");
        }
        const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
        await db.from("ghl_webhook_events").delete().lt("received_at", monthAgo);
        await db.from("ghl_sync_jobs").delete().eq("status", "done").lt("finished_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
        await save({ status: "succeeded", finished_at: new Date().toISOString() });
        return { runId: run.id, done: true, stats };
      }
    }
    await save();
    return { runId: run.id, done: false, stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("ghl", "reconcile failed", error, { run: run.id });
    await save({ status: "failed", error: message.slice(0, 500), finished_at: new Date().toISOString() });
    throw error;
  }
}

// Staff actions (the route has already checked integrations.manage).
export async function retryFailedJobs() {
  const db = createAdminSupabaseClient();
  const { data } = await db.from("ghl_sync_jobs").update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in("status", ["failed", "dead"]).select("id");
  return data?.length ?? 0;
}

export async function syncContactNow(contactId: string, deadline: number) {
  if (!isGhlId(contactId)) throw new Error("Invalid GHL contact id");
  await enqueueContacts([contactId], "staff requested");
  return drainQueue(deadline);
}

// "Use the GHL value" for a conflict: writes it to the dashboard with the secret
// key and records it as the agreed value (so nothing is pushed back).
export async function takeGhlValue(talentId: string, target: string, value: string) {
  const db = createAdminSupabaseClient();
  const dashboard = await loadDashboard(db, talentId);
  await writeDashboard(db, talentId, new Map([[target as never, value]]), dashboard);
  await db.from("ghl_field_state").upsert({ talent_id: talentId, target, value, source: "ghl", synced_at: new Date().toISOString() }, { onConflict: "talent_id,target" });
}

// "Keep the dashboard value": GHL's value becomes the agreed base, so the next
// push (when write-back is on) sends the dashboard value to GHL.
export async function keepDashboardValue(talentId: string, target: string, ghlValue: string | null) {
  const db = createAdminSupabaseClient();
  await db.from("ghl_field_state").upsert({ talent_id: talentId, target, value: ghlValue, source: "ghl", synced_at: new Date().toISOString() }, { onConflict: "talent_id,target" });
  const { data: contact } = await db.from("ghl_contacts").select("id").eq("talent_id", talentId).maybeSingle();
  if (contact) {
    const insert = await db.from("ghl_sync_jobs").insert({ kind: "push_contact", external_id: contact.id, reason: "conflict resolved: kept dashboard" });
    if (insert.error && insert.error.code !== "23505") throw insert.error;
  }
}
