import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/api";
import { log } from "@/lib/log";

export type ConvertResult =
  | { ok: true; talentId: string; photosCopied: number; photosSkipped: number }
  | { ok: false; notFound: boolean; error: { code?: string; message: string } };

// Converts one application into a draft talent record under the caller's own
// session (convert_application() checks permissions and does the database part
// in one transaction), then copies its stored photos into the talent's private
// media when the caller may manage media. Nothing is published. Safe to repeat:
// a converted application returns its existing talent and photos are not copied twice.
export async function convertApplication(supabase: SupabaseClient, id: string, canManageMedia: boolean): Promise<ConvertResult> {
  const { data: talentId, error } = await supabase.rpc("convert_application", { p_application_id: id });
  if (error) return { ok: false, notFound: error.code === "P0002", error };

  let copied = 0;
  let skipped = 0;
  if (canManageMedia) {
    const { data: photos } = await supabase.from("application_photos").select("id,kind,storage_path").eq("application_id", id).eq("status", "stored").order("created_at");
    const { data: existing } = await supabase.from("talent_photos").select("original_file_name").eq("talent_id", talentId);
    const done = new Set((existing ?? []).map((row: { original_file_name: string | null }) => row.original_file_name));
    for (const [index, photo] of ((photos ?? []) as { id: string; kind: string; storage_path: string }[]).entries()) {
      const marker = `application-photo:${photo.id}`;
      if (done.has(marker)) continue;
      const path = `talent/${talentId}/application-${photo.id}.jpg`;
      const copy = await supabase.storage.from("applications").copy(photo.storage_path, path, { destinationBucket: "talent-private" });
      if (copy.error && !/exists/i.test(copy.error.message)) {
        log.warn("applications", "photo copy failed", { application: id, photo: photo.id, error: copy.error.message });
        skipped += 1;
        continue;
      }
      const insert = await supabase.from("talent_photos").insert({
        talent_id: talentId, storage_path: path, storage_bucket: "talent-private", public: false, publish_to_website: false,
        image_type: "digital", title: photo.kind.replace("_", " "), original_file_name: marker, mime_type: "image/jpeg", display_order: index,
      });
      if (insert.error) { skipped += 1; continue; }
      copied += 1;
    }
  }

  await writeAudit(supabase, { action: "talent.created", entityType: "talent", entityId: talentId, metadata: { from_application: id, photos_copied: copied } });
  return { ok: true, talentId, photosCopied: copied, photosSkipped: skipped };
}
