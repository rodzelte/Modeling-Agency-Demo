import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireEntitledPortalApi } from "@/features/portal/context";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireEntitledPortalApi();
  if ("response" in auth) return auth.response;
  const { supabase, profile } = auth.portal;
  const { error } = await supabase.from("talent_availability").delete().eq("id", id).eq("talent_id", profile.id);
  if (error) return databaseError(error, "remove those dates");
  return NextResponse.json({ ok: true });
}
