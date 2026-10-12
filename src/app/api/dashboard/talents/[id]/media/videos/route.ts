import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue, optionalText } from "@/lib/validation";
import { parseVideoUrl } from "@/features/media/video";
import { refreshPublicSite } from "@/features/public/cache";

const schema = z.union([
  z.object({ url: z.string().trim().min(1).max(500), title: optionalText(160) }),
  z.object({ storage_path: z.string().trim().min(1).max(500), title: optionalText(160) }),
]);

// Adds a YouTube/Vimeo link or an uploaded video file (stored privately). Videos
// start private; publishing is a separate step.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("media.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  let row: Record<string, unknown>;
  if ("url" in parsed.data) {
    const video = parseVideoUrl(parsed.data.url);
    if (!video) return NextResponse.json({ error: "Paste a YouTube or Vimeo link" }, { status: 400 });
    row = { provider: video.provider, external_id: video.externalId, url: parsed.data.url, title: parsed.data.title ?? null };
  } else {
    if (!parsed.data.storage_path.startsWith(`talent/${id}/`)) return NextResponse.json({ error: "Invalid video path" }, { status: 400 });
    row = { provider: "upload", storage_path: parsed.data.storage_path, title: parsed.data.title ?? null };
  }

  const { supabase } = auth.context;
  const { count } = await supabase.from("talent_videos").select("id", { count: "exact", head: true }).eq("talent_id", id).is("archived_at", null);
  const { data, error } = await supabase.from("talent_videos").insert({ talent_id: id, ...row, public: false, display_order: count ?? 0 }).select("id").single();
  if (error) return databaseError(error, "save the video");
  await writeAudit(supabase, { action: "video.added", entityType: "talent", entityId: id, metadata: { video_id: data.id, provider: row.provider } });
  return NextResponse.json(data, { status: 201 });
}
