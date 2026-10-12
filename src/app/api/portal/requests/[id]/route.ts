import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requirePortalApi } from "@/features/portal/context";

// Withdraw a pending request.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requirePortalApi();
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.portal.supabase.from("talent_change_requests").update({ status: "withdrawn" }).eq("id", id).eq("status", "pending").select("id").maybeSingle();
  if (error) return databaseError(error, "withdraw the request");
  if (!data) return NextResponse.json({ error: "Request not found or already reviewed" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
