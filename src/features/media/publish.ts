import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PublishablePhoto = { id: string; storage_path: string; storage_bucket: string; public_storage_path: string | null };

// Publishing copies the private original into talent-public and records the copy;
// withdrawing removes the copy. The original is always preserved. Runs as the
// caller (media.manage RLS and storage policies apply). Returns the column
// changes to save, or an error from storage.
export async function publicCopyChanges(supabase: SupabaseClient, talentId: string, photo: PublishablePhoto, makePublic: boolean)
  : Promise<{ changes: Record<string, unknown>; error?: { message?: string } }> {
  if (makePublic) {
    if (photo.public_storage_path) return { changes: { public: true, publish_to_website: true } };
    if (photo.storage_bucket === "talent-public") return { changes: { public: true, publish_to_website: true, public_storage_path: photo.storage_path } };
    const publicPath = `talent/${talentId}/${photo.id}-${photo.storage_path.split("/").pop()}`;
    const copy = await supabase.storage.from("talent-private").copy(photo.storage_path, publicPath, { destinationBucket: "talent-public" });
    // A copy left by an earlier attempt is fine to reuse.
    if (copy.error && !/exists/i.test(copy.error.message)) return { changes: {}, error: copy.error };
    return { changes: { public: true, publish_to_website: true, public_storage_path: publicPath } };
  }
  if (photo.public_storage_path && photo.storage_bucket === "talent-private") {
    const removal = await supabase.storage.from("talent-public").remove([photo.public_storage_path]);
    if (removal.error) return { changes: {}, error: removal.error };
  }
  return { changes: { public: false, publish_to_website: false, public_storage_path: null } };
}
