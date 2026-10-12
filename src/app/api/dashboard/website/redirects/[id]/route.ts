import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { refreshPublicSite } from "@/features/public/cache";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("website.manage");
  if ("response" in auth) return auth.response;
  const parsed = z.object({ is_active: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected is_active" }, { status: 400 });
  refreshPublicSite();
  const { error } = await auth.context.supabase.from("website_redirects").update(parsed.data).eq("id", id);
  if (error) return databaseError(error, "update the redirect");
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("website.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const { error } = await auth.context.supabase.from("website_redirects").delete().eq("id", id);
  if (error) return databaseError(error, "delete the redirect");
  return NextResponse.json({ ok: true });
}
