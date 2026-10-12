import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue, optionalText } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";

const schema = z.object({
  public: z.boolean().optional(),
  archived: z.boolean().optional(),
  title: optionalText(160),
  display_order: z.number().int().min(0).max(10000).optional(),
});

type Video = { id: string; provider: string; storage_path: string | null; public_storage_path: string | null };

// Publishing an uploaded file copies it to talent-public; links need no copy.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; videoId: string }> }) {
  const { id, videoId } = await params;
  const auth = await requireApi("media.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const { supabase } = auth.context;
  const { data: video, error } = await supabase.from("talent_videos").select("id,provider,storage_path,public_storage_path").eq("id", videoId).eq("talent_id", id).maybeSingle<Video>();
  if (error) return databaseError(error, "load the video");
  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const { public: makePublic, archived, ...rest } = parsed.data;
  const update: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
  if (video.provider === "upload" && video.storage_path) {
    if (makePublic === true && !video.public_storage_path) {
      const publicPath = `talent/${id}/${video.id}-${video.storage_path.split("/").pop()}`;
      const copy = await supabase.storage.from("talent-private").copy(video.storage_path, publicPath, { destinationBucket: "talent-public" });
      if (copy.error) return databaseError(copy.error, "publish this video");
      update.public_storage_path = publicPath;
    }
    if ((makePublic === false || archived) && video.public_storage_path) {
      await supabase.storage.from("talent-public").remove([video.public_storage_path]);
      update.public_storage_path = null;
    }
  }
  if (makePublic !== undefined) update.public = makePublic;
  if (archived !== undefined) Object.assign(update, { archived_at: archived ? new Date().toISOString() : null, ...(archived ? { public: false } : {}) });

  const { error: updateError } = await supabase.from("talent_videos").update(update).eq("id", video.id);
  if (updateError) return databaseError(updateError, "update the video");
  await writeAudit(supabase, { action: archived ? "video.archived" : makePublic === undefined ? "video.edited" : makePublic ? "video.published" : "video.unpublished", entityType: "talent", entityId: id, metadata: { video_id: video.id } });
  return NextResponse.json({ ok: true });
}
