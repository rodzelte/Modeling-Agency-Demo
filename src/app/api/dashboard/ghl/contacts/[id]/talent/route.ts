import { NextResponse } from "next/server";
import { requireApi } from "@/lib/agency-auth";
import { databaseError } from "@/lib/api";
import { log } from "@/lib/log";
import { isGhlId, syncContactNow } from "@/features/ghl/engine";

// "Create talent" for a GHL contact whose status does not create one
// automatically. ghl_link_talent() runs as the caller (it checks
// integrations.manage + talent.create + talent.private.edit and links an
// existing talent instead when one clearly matches); then the contact is synced
// so details and photos arrive. The new talent is a private draft.
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApi(["integrations.manage", "talent.create", "talent.private.edit"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isGhlId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: talentId, error } = await auth.context.supabase.rpc("ghl_link_talent", { p_contact_id: id, p_create: true });
  if (error) return error.code === "P0002" ? NextResponse.json({ error: "Contact not found" }, { status: 404 }) : databaseError(error, "create the talent");
  try {
    await syncContactNow(id, Date.now() + 45_000);
  } catch (failure) {
    log.warn("ghl", "sync after create failed", { contact: id, error: failure instanceof Error ? failure.message : String(failure) });
  }
  return NextResponse.json({ talentId });
}
