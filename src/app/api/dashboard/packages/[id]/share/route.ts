import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { requestOrigin, siteOrigin } from "@/lib/site";
import { hashShareToken, newShareToken } from "@/features/packages/share";

const schema = z.object({ days: z.coerce.number().int().min(1).max(180).default(30) });

// Creates (or rotates) the share link. The token is returned once and never stored.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("packages.manage");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  const days = parsed.success ? parsed.data.days : 30;
  const token = newShareToken();
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const { data, error } = await auth.context.supabase.from("packages")
    .update({ share_token_hash: hashShareToken(token), shared_at: new Date().toISOString(), expires_at: expiresAt, revoked_at: null })
    .eq("id", id).select("id").maybeSingle();
  if (error) return databaseError(error, "create the link");
  if (!data) return NextResponse.json({ error: "Package not found" }, { status: 404 });
  const origin = siteOrigin() ?? requestOrigin(request);
  return NextResponse.json({ url: `${origin}/p/${token}`, expires_at: expiresAt });
}

// Revokes the link immediately.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("packages.manage");
  if ("response" in auth) return auth.response;
  const { error } = await auth.context.supabase.from("packages").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) return databaseError(error, "revoke the link");
  return NextResponse.json({ ok: true });
}
