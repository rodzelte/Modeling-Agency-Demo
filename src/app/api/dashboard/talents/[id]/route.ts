import { NextResponse } from "next/server";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { updateTalentSchema } from "@/features/talent/schemas";
import { refreshPublicSite } from "@/features/public/cache";

// Updates core fields (talent.edit) and/or private details (talent.private.edit).
// Publication changes go through ./publication so their permission is explicit.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("talent.view");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const { supabase, permissions } = auth.context;

  const parsed = updateTalentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const core = parsed.data.core ? definedOnly(parsed.data.core) : null;
  const privateDetails = parsed.data.private ? definedOnly(parsed.data.private) : null;

  if (core && Object.keys(core).length) {
    if (!permissions.has("talent.edit")) return NextResponse.json({ error: "You do not have permission to edit talent details" }, { status: 403 });
    const { error } = await supabase.from("talent").update(core).eq("id", id).select("id").single();
    if (error?.code === "23505") return NextResponse.json({ error: "That URL slug or talent ID is already in use" }, { status: 409 });
    if (error) return databaseError(error, "update the talent record");
  }

  if (privateDetails && Object.keys(privateDetails).length) {
    if (!permissions.has("talent.private.edit")) return NextResponse.json({ error: "You do not have permission to edit private details" }, { status: 403 });
    const { error } = await supabase.from("talent_private_details").upsert({ talent_id: id, ...privateDetails }, { onConflict: "talent_id" });
    if (error) return databaseError(error, "update private details");
  }

  // Field names only: values such as DOB and phone numbers stay out of the audit log.
  await writeAudit(supabase, {
    action: "talent.edited",
    entityType: "talent",
    entityId: id,
    metadata: { fields: [...Object.keys(core ?? {}), ...Object.keys(privateDetails ?? {}).map((key) => `private.${key}`)] },
  });
  return NextResponse.json({ ok: true });
}
