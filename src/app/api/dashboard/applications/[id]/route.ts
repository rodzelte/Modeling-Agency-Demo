import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";

// Review status. "converted" is only reachable through /convert; the database
// records who changed the status and audits it.
const schema = z.object({ status: z.enum(["new", "reviewing", "info_requested", "approved", "rejected", "archived"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("applications.manage");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { data, error } = await auth.context.supabase.from("applications").update({ status: parsed.data.status }).eq("id", id).neq("status", "converted").select("id").maybeSingle();
  if (error) return databaseError(error, "update the application");
  if (!data) return NextResponse.json({ error: "Application not found, or already converted" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Owner-only erasure (data-subject deletion request): photos first, then the
// application with its notes and photo rows. Only the fact of erasure is logged.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("team.manage");
  if ("response" in auth) return auth.response;
  const { supabase } = auth.context;
  const { data: photos } = await supabase.from("application_photos").select("storage_path").eq("application_id", id);
  const paths = (photos ?? []).map((photo: { storage_path: string | null }) => photo.storage_path).filter(Boolean) as string[];
  if (paths.length) {
    const { error: removeError } = await supabase.storage.from("applications").remove(paths);
    if (removeError) return databaseError(removeError, "delete the application photos");
  }
  const { data, error } = await supabase.from("applications").delete().eq("id", id).select("id").maybeSingle();
  if (error) return databaseError(error, "erase the application");
  if (!data) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  await writeAudit(supabase, { action: "privacy.application_erased", entityType: "application", entityId: id, metadata: { photos: paths.length } });
  return NextResponse.json({ ok: true });
}
