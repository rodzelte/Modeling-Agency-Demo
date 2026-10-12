import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue, optionalText } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";
import { publicCopyChanges } from "@/features/media/publish";

const percent = z.union([z.number(), z.string()]).transform((value) => Math.min(100, Math.max(0, Number(value) || 0)));

const schema = z.object({
  public: z.boolean().optional(),
  review_status: z.enum(["approved", "rejected"]).optional(),
  archived: z.boolean().optional(),
  title: optionalText(160),
  alt_text: optionalText(240),
  photographer: optionalText(160),
  image_type: z.string().trim().max(40).optional(),
  type_of_work: optionalText(120),
  support_name: optionalText(160),
  country_of_publication: optionalText(120),
  focal_x: percent.optional(),
  focal_y: percent.optional(),
});

type Photo = { id: string; storage_path: string; storage_bucket: string; public_storage_path: string | null };

// Publishing copies the private original into talent-public; withdrawing (or
// archiving) removes that copy (features/media/publish.ts). The original is always preserved.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const { id, photoId } = await params;
  const auth = await requireApi("media.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const { supabase } = auth.context;
  const { data: photo, error } = await supabase.from("talent_photos").select("id,storage_path,storage_bucket,public_storage_path").eq("id", photoId).eq("talent_id", id).maybeSingle<Photo>();
  if (error) return databaseError(error, "load the image");
  if (!photo) return NextResponse.json({ error: "Image not found" }, { status: 404 });

  const { public: makePublic, archived, focal_x, focal_y, ...details } = parsed.data;
  const update: Record<string, unknown> = definedOnly(details);
  if (focal_x !== undefined || focal_y !== undefined) update.focal_point = { x: focal_x ?? 50, y: focal_y ?? 50 };

  const withdraw = makePublic === false || archived === true;
  if (makePublic === true || (withdraw && photo.public_storage_path)) {
    const result = await publicCopyChanges(supabase, id, photo, makePublic === true);
    if (result.error) return databaseError(result.error, makePublic ? "publish this image" : "withdraw this image");
    Object.assign(update, result.changes);
  }
  if (makePublic === false) Object.assign(update, { public: false, publish_to_website: false });
  if (archived !== undefined) Object.assign(update, { archived_at: archived ? new Date().toISOString() : null, ...(archived ? { public: false, publish_to_website: false, featured: false } : {}) });

  const { error: updateError } = await supabase.from("talent_photos").update({ ...update, updated_at: new Date().toISOString() }).eq("id", photo.id);
  if (updateError) return databaseError(updateError, "update the image");

  const action = parsed.data.review_status ? `media.review_${parsed.data.review_status}` : archived ? "media.archived" : makePublic === true ? "media.published" : makePublic === false ? "media.unpublished" : "media.edited";
  await writeAudit(supabase, { action, entityType: "talent", entityId: id, metadata: { photo_id: photo.id, fields: Object.keys(update) } });
  return NextResponse.json({ ok: true });
}
