import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue, optionalNumber, optionalText } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";

// New media is always private: the original stays in talent-private and reaches the
// website only through an explicit promotion (PATCH /media/[photoId]).
const schema = z.object({
  storage_path: z.string().trim().min(1).max(500),
  title: optionalText(160),
  alt_text: optionalText(240),
  photographer: optionalText(160),
  image_type: z.string().trim().max(40).optional(),
  original_file_name: optionalText(240),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
  file_size: optionalNumber,
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("media.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  if (!parsed.data.storage_path.startsWith(`talent/${id}/`)) return NextResponse.json({ error: "Invalid media path" }, { status: 400 });

  const { supabase } = auth.context;
  const { count } = await supabase.from("talent_photos").select("id", { count: "exact", head: true }).eq("talent_id", id).is("archived_at", null);
  const { data, error } = await supabase.from("talent_photos").insert({
    talent_id: id,
    ...parsed.data,
    image_type: parsed.data.image_type || "portfolio",
    storage_bucket: "talent-private",
    public: false,
    publish_to_website: false,
    display_order: count ?? 0,
  }).select("id").single();
  if (error) return databaseError(error, "save the media record");
  await writeAudit(supabase, { action: "media.uploaded", entityType: "talent", entityId: id, metadata: { photo_id: data.id } });
  return NextResponse.json(data, { status: 201 });
}
