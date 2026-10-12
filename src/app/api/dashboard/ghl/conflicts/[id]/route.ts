import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApi } from "@/lib/agency-auth";
import { databaseError } from "@/lib/api";
import { log } from "@/lib/log";
import { keepDashboardValue, takeGhlValue } from "@/features/ghl/engine";

// Resolves a sync conflict: use GHL's value, keep the dashboard's (pushed to GHL
// when write-back is on), or dismiss. The conflict row is updated under the
// caller's session, so the database stamps and audits who decided.
const schema = z.object({ resolution: z.enum(["took_ghl", "kept_dashboard", "dismissed"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApi(["integrations.manage", "talent.edit", "talent.private.edit"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { supabase } = auth.context;

  const { data: conflict, error } = await supabase.from("ghl_sync_conflicts").select("id,talent_id,target,ghl_value,status").eq("id", id).maybeSingle();
  if (error) return databaseError(error, "load the conflict");
  if (!conflict || conflict.status !== "open") return NextResponse.json({ error: "This conflict is already resolved" }, { status: 409 });

  try {
    if (parsed.data.resolution === "took_ghl" && conflict.ghl_value !== null) await takeGhlValue(conflict.talent_id, conflict.target, conflict.ghl_value);
    if (parsed.data.resolution === "kept_dashboard") await keepDashboardValue(conflict.talent_id, conflict.target, conflict.ghl_value);
  } catch (failure) {
    log.error("ghl", "conflict resolution failed", failure, { conflict: id });
    return NextResponse.json({ error: "The value could not be applied. Try again." }, { status: 500 });
  }
  const update = await supabase.from("ghl_sync_conflicts").update({ status: parsed.data.resolution }).eq("id", id).select("id");
  if (update.error) return databaseError(update.error, "resolve the conflict");
  return NextResponse.json({ ok: true });
}
