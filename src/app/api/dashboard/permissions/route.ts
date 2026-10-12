import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";

const schema = z.object({ role: z.string().regex(/^[a-z_]+$/), permission: z.string().regex(/^[a-z_.]+$/), granted: z.boolean() });

// Owner-only change to the role/permission matrix. The database refuses changes
// to the owner role and any grant to the talent role, and audits every change.
export async function POST(request: Request) {
  const auth = await requireApi("team.manage");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { role, permission, granted } = parsed.data;
  if (role === "owner" || role === "talent") return NextResponse.json({ error: role === "owner" ? "The owner always has every permission" : "Talent logins cannot be given staff permissions" }, { status: 400 });
  const { supabase } = auth.context;
  const { error } = granted
    ? await supabase.from("role_permissions").upsert({ role_key: role, permission_key: permission }, { onConflict: "role_key,permission_key", ignoreDuplicates: true })
    : await supabase.from("role_permissions").delete().eq("role_key", role).eq("permission_key", permission);
  if (error) return databaseError(error, "update the permission");
  return NextResponse.json({ ok: true });
}
