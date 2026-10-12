import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { companySchema } from "@/features/operations/schemas";

export async function POST(request: Request) {
  const auth = await requireApi("operations.manage");
  if ("response" in auth) return auth.response;
  const parsed = companySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { data, error } = await auth.context.supabase.from("companies").insert(definedOnly(parsed.data)).select("id").single();
  if (error) return databaseError(error, "create the company");
  return NextResponse.json(data, { status: 201 });
}
