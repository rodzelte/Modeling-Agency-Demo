import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { contactSchema } from "@/features/operations/schemas";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("operations.manage");
  if ("response" in auth) return auth.response;
  const parsed = contactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { data, error } = await auth.context.supabase.from("company_contacts").insert({ ...definedOnly(parsed.data), company_id: id }).select("id").single();
  if (error) return databaseError(error, "add the contact");
  return NextResponse.json(data, { status: 201 });
}
