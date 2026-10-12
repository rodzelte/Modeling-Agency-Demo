import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { refreshPublicSite } from "@/features/public/cache";
import { parseSections } from "@/features/cms/blocks";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi(["website.manage", "website.publish"]);
  if ("response" in auth) return auth.response;
  const { supabase } = auth.context;
  // Never publish content that would not render.
  const { data: page } = await supabase.from("website_pages").select("sections").eq("id", id).maybeSingle();
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });
  const parsed = parseSections(page.sections);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  refreshPublicSite();
  const { error } = await supabase.rpc("publish_website_page", { p_page_id: id });
  if (error) return error.code === "22023" ? NextResponse.json({ error: error.message }, { status: 409 }) : databaseError(error, "publish the page");
  return NextResponse.json({ ok: true });
}
