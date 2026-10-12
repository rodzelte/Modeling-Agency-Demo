import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { contactSchema } from "@/features/operations/schemas";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("operations.manage");
  if ("response" in auth) return auth.response;
  const parsed = contactSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { data, error } = await auth.context.supabase.from("company_contacts").update(definedOnly(parsed.data)).eq("id", id).select("id").maybeSingle();
  if (error) return databaseError(error, "save the contact");
  if (!data) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("operations.manage");
  if ("response" in auth) return auth.response;
  const { error } = await auth.context.supabase.from("company_contacts").delete().eq("id", id);
  if (error) return databaseError(error, "delete the contact");
  return NextResponse.json({ ok: true });
}
