import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Enter the talent's email address").max(200) });

// Invite (or re-invite with a new email). The talent then signs in at /portal/login.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("talent.private.edit");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { error } = await auth.context.supabase.rpc("invite_talent_to_portal", { p_talent_id: id, p_email: parsed.data.email });
  if (error?.code === "23505") return NextResponse.json({ error: "That email already belongs to a staff account or another talent" }, { status: 409 });
  if (error?.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 });
  if (error) return databaseError(error, "send the invitation");
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("talent.private.edit");
  if ("response" in auth) return auth.response;
  const { error } = await auth.context.supabase.rpc("revoke_talent_portal", { p_talent_id: id });
  if (error) return databaseError(error, "revoke portal access");
  return NextResponse.json({ ok: true });
}
