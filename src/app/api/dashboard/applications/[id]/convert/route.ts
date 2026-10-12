import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { convertApplication } from "@/features/applications/convert";

// Converts an application into a draft talent record, with its photos copied
// into the talent's private media (features/applications/convert.ts). Nothing is published.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi(["applications.manage", "talent.create", "talent.private.edit"]);
  if ("response" in auth) return auth.response;
  const { supabase, permissions } = auth.context;

  const result = await convertApplication(supabase, id, permissions.has("media.manage"));
  if (!result.ok) return result.notFound ? NextResponse.json({ error: "Application not found" }, { status: 404 }) : databaseError(result.error, "convert the application");
  return NextResponse.json({ talent_id: result.talentId, photos_copied: result.photosCopied, photos_skipped: result.photosSkipped, photos_need_media_permission: !permissions.has("media.manage") }, { status: 201 });
}
