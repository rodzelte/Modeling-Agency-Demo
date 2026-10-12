import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApi } from "@/lib/agency-auth";
import { writeAudit } from "@/lib/api";
import { log } from "@/lib/log";
import { ghlConfigured } from "@/features/ghl/client";
import { reconcile, retryFailedJobs, syncContactNow } from "@/features/ghl/engine";

// Staff sync actions: run (or continue) a reconciliation step, retry failed and
// dead jobs, or re-sync one contact now. The sync runs with the secret key after
// this route has checked integrations.manage; every action is audited.
export const maxDuration = 60;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reconcile") }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("contact"), contactId: z.string().regex(/^[A-Za-z0-9]{8,64}$/) }),
]);

export async function POST(request: Request) {
  const auth = await requireApi("integrations.manage");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (!ghlConfigured()) return NextResponse.json({ error: "GHL is not connected: set GHL_API_TOKEN and GHL_LOCATION_ID on the server" }, { status: 503 });
  const { supabase, user } = auth.context;

  try {
    if (parsed.data.action === "retry") {
      const count = await retryFailedJobs();
      await writeAudit(supabase, { action: "ghl.retry_failed", entityType: "ghl_sync", metadata: { jobs: count } });
      return NextResponse.json({ retried: count });
    }
    if (parsed.data.action === "contact") {
      const stats = await syncContactNow(parsed.data.contactId, Date.now() + 45_000);
      await writeAudit(supabase, { action: "ghl.contact_synced", entityType: "ghl_contact", metadata: { contact: parsed.data.contactId } });
      return NextResponse.json({ stats });
    }
    const result = await reconcile("dashboard", Date.now() + 45_000, user.id);
    if (result.done) await writeAudit(supabase, { action: "ghl.sync_run", entityType: "ghl_sync", metadata: { run: result.runId } });
    return NextResponse.json({ done: result.done, run: result.runId, stats: result.stats });
  } catch (error) {
    log.error("ghl", "dashboard sync action failed", error, { action: parsed.data.action });
    return NextResponse.json({ error: "The sync failed. Details are on the GHL Sync page." }, { status: 502 });
  }
}
