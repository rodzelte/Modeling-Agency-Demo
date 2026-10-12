import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { refreshPublicSite } from "@/features/public/cache";

// Takes a page offline (back to draft), archives it, or restores an archived page to draft.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi(["website.manage", "website.publish"]);
  if ("response" in auth) return auth.response;
  const body = z.object({ archive: z.boolean().default(false) }).safeParse(await request.json().catch(() => ({})));
  refreshPublicSite();
  const { error } = await auth.context.supabase.rpc("unpublish_website_page", { p_page_id: id, p_archive: body.success ? body.data.archive : false });
  if (error) return databaseError(error, "unpublish the page");
  return NextResponse.json({ ok: true });
}
