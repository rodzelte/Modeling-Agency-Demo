import { NextResponse } from "next/server";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { companySchema } from "@/features/operations/schemas";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("operations.manage");
  if ("response" in auth) return auth.response;
  const parsed = companySchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { data, error } = await auth.context.supabase.from("companies").update(definedOnly(parsed.data)).eq("id", id).select("id").maybeSingle();
  if (error) return databaseError(error, "save the company");
  if (!data) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Bookings keep their history: the company link is cleared, the bookings stay.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("operations.manage");
  if ("response" in auth) return auth.response;
  const { supabase } = auth.context;
  const { data, error } = await supabase.from("companies").delete().eq("id", id).select("id,name").maybeSingle();
  if (error) return databaseError(error, "delete the company");
  if (!data) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  await writeAudit(supabase, { action: "company.deleted", entityType: "company", entityId: id });
  return NextResponse.json({ ok: true });
}
