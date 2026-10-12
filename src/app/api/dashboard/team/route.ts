import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { ownerManagedRoles, requireApi } from "@/lib/agency-auth";
import { siteOrigin } from "@/lib/site";
import { firstIssue } from "@/lib/validation";
import { createMemberAccount } from "@/features/team/accounts";

const memberSchema = z.object({
  email: z.email().trim().transform((value) => value.toLowerCase()),
  fullName: z.string().trim().max(120).optional().default(""),
  role: z.enum(ownerManagedRoles),
  status: z.enum(["active", "pending", "suspended"]).default("active"),
  // Optional temporary password for people who don't sign in with Google; they
  // choose their own at first sign-in.
  password: z.string().max(72, "Use a password of at most 72 characters").optional()
    .transform((value) => value || undefined)
    .refine((value) => value === undefined || value.length >= 10, "Use a temporary password of at least 10 characters"),
});

export async function GET() {
  const auth = await requireApi("team.manage");
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.context.supabase
    .from("agency_members")
    .select("id,email,full_name,role,status,user_id,created_at,updated_at")
    .order("created_at", { ascending: true });
  if (error) return databaseError(error, "load the team");
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const auth = await requireApi("team.manage");
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth.context;

  const parsed = memberSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const { email, fullName, role, status, password } = parsed.data;
  const { data: existing, error: existingError } = await supabase.from("agency_members").select("id,role,user_id").eq("email", email).maybeSingle();
  if (existingError) return databaseError(existingError, "load the team");
  if (existing?.role === "owner") return NextResponse.json({ error: "Owner access is changed from the database, not the team form" }, { status: 400 });
  if (password && existing?.user_id) return NextResponse.json({ error: "This person already has an account. They can change their password in My profile, or use “Forgot password” on the sign-in page." }, { status: 400 });

  const payload = { email, full_name: fullName, role, status, invited_by: user.id, updated_at: new Date().toISOString() };
  const query = existing
    ? supabase.from("agency_members").update(payload).eq("id", existing.id)
    : supabase.from("agency_members").insert(payload);
  const { data: member, error } = await query.select("id,email,full_name,role,status,user_id,created_at,updated_at").single();
  if (error || !member) return databaseError(error, "save this team member");

  // The database binds the membership to the Auth user, mirrors the role onto the
  // profile, and writes the audit event (migration 009).
  if (password && !member.user_id) {
    const account = await createMemberAccount({ email, fullName }, password, siteOrigin() ?? new URL(request.url).origin);
    if (account.error) return NextResponse.json({ error: `Access saved, but no password was set: ${account.error}` }, { status: 400 });
    await writeAudit(supabase, { action: "agency_member.account_created", entityType: "agency_members", entityId: member.id });
    return NextResponse.json({ ...member, confirmation_sent: account.confirmationSent }, { status: existing ? 200 : 201 });
  }
  return NextResponse.json(member, { status: existing ? 200 : 201 });
}

// Removes a teammate's access. The database suspends their profile, clears their
// role mirror and writes the audit event (migration 009); owners cannot be removed.
// Their sign-in account remains but grants nothing without a membership.
export async function DELETE(request: Request) {
  const auth = await requireApi("team.manage");
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth.context;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: member, error: loadError } = await supabase.from("agency_members").select("id,role,user_id").eq("id", id).maybeSingle();
  if (loadError) return databaseError(loadError, "load the team");
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (member.role === "owner") return NextResponse.json({ error: "Owner access cannot be removed here" }, { status: 400 });
  if (member.user_id === user.id) return NextResponse.json({ error: "You cannot remove your own access" }, { status: 400 });

  const { error } = await supabase.from("agency_members").delete().eq("id", id);
  if (error) return databaseError(error, "remove this team member");
  return new NextResponse(null, { status: 204 });
}
