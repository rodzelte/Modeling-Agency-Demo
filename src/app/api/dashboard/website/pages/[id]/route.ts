import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { refreshPublicSite } from "@/features/public/cache";
import { validatePageInput } from "@/features/cms/validate";

// Saves the working copy. Live pages change only when published.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("website.manage");
  if ("response" in auth) return auth.response;
  const checked = validatePageInput(await request.json().catch(() => null));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { data, error } = await auth.context.supabase.from("website_pages").update(checked.value).eq("id", id).select("id,has_unpublished_changes").maybeSingle();
  if (error?.code === "23505") return NextResponse.json({ error: "A page already uses that address" }, { status: 409 });
  if (error) return databaseError(error, "save the page");
  if (!data) return NextResponse.json({ error: "Page not found" }, { status: 404 });
  return NextResponse.json(data);
}

// Only unpublished pages can be deleted (the database enforces it too).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("website.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const { data, error } = await auth.context.supabase.from("website_pages").delete().eq("id", id).select("id").maybeSingle();
  if (error) return databaseError(error, "delete the page");
  if (!data) return NextResponse.json({ error: "Unpublish the page before deleting it" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
