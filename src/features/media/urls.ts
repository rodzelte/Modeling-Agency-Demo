import type { SupabaseClient } from "@supabase/supabase-js";

export type StoredPhoto = { id: string; storage_bucket: string; storage_path: string; public_storage_path: string | null };

export function publicMediaUrl(supabase: SupabaseClient, path: string) {
  return supabase.storage.from("talent-public").getPublicUrl(path).data.publicUrl;
}

// Dashboard thumbnails: promoted copies use their public URL; private originals get
// a short-lived signed URL (never a public link).
export async function photoUrls(supabase: SupabaseClient, photos: StoredPhoto[], expiresIn = 3600) {
  const urls = new Map<string, string>();
  const privatePaths: { id: string; path: string }[] = [];
  for (const photo of photos) {
    if (photo.public_storage_path) urls.set(photo.id, publicMediaUrl(supabase, photo.public_storage_path));
    else if (photo.storage_bucket === "talent-public") urls.set(photo.id, publicMediaUrl(supabase, photo.storage_path));
    else privatePaths.push({ id: photo.id, path: photo.storage_path });
  }
  if (privatePaths.length) {
    const { data } = await supabase.storage.from("talent-private").createSignedUrls(privatePaths.map((item) => item.path), expiresIn);
    for (const [index, signed] of (data ?? []).entries()) {
      if (signed.signedUrl) urls.set(privatePaths[index].id, signed.signedUrl);
    }
  }
  return urls;
}
