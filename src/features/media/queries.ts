import type { SupabaseClient } from "@supabase/supabase-js";
import { photoUrls, type StoredPhoto } from "./urls";
import { PHOTO_COLUMNS, type MediaCollection, type MediaPhoto, type MediaVideo } from "./types";

export async function loadMedia(supabase: SupabaseClient, talentId: string) {
  const [photos, videos, portfolios, books] = await Promise.all([
    supabase.from("talent_photos").select(PHOTO_COLUMNS).eq("talent_id", talentId).is("archived_at", null).order("display_order").order("created_at"),
    supabase.from("talent_videos").select("id,title,provider,external_id,url,public,display_order").eq("talent_id", talentId).is("archived_at", null).order("display_order"),
    supabase.from("portfolios").select("id,name,slug,description,public,is_default,display_order,portfolio_images(photo_id,display_order)").eq("talent_id", talentId).order("display_order"),
    supabase.from("digital_books").select("id,name,public,display_order,digital_book_images(photo_id,display_order)").eq("talent_id", talentId).order("display_order"),
  ]);
  for (const result of [photos, videos, portfolios, books]) if (result.error) throw result.error;

  const photoRows = (photos.data ?? []) as unknown as (StoredPhoto & Omit<MediaPhoto, "url">)[];
  const urls = await photoUrls(supabase, photoRows);
  const ordered = (items: { photo_id: string; display_order: number }[]) => [...items].sort((a, b) => a.display_order - b.display_order).map((item) => item.photo_id);

  return {
    photos: photoRows.map((photo): MediaPhoto => ({
      id: photo.id, url: urls.get(photo.id) ?? null, title: photo.title, alt_text: photo.alt_text, photographer: photo.photographer,
      type_of_work: photo.type_of_work, support_name: photo.support_name, country_of_publication: photo.country_of_publication,
      image_type: photo.image_type, display_order: photo.display_order, featured: photo.featured, public: photo.public,
      archived_at: photo.archived_at, focal_point: photo.focal_point, review_status: photo.review_status, uploaded_by_talent: photo.uploaded_by_talent,
    })),
    videos: (videos.data ?? []) as MediaVideo[],
    portfolios: (portfolios.data ?? []).map((row): MediaCollection => ({
      id: row.id, kind: "portfolio", name: row.name, slug: row.slug, description: row.description, public: row.public, is_default: row.is_default,
      photo_ids: ordered(row.portfolio_images as { photo_id: string; display_order: number }[]),
    })),
    books: (books.data ?? []).map((row): MediaCollection => ({
      id: row.id, kind: "book", name: row.name, slug: null, description: null, public: row.public, is_default: false,
      photo_ids: ordered(row.digital_book_images as { photo_id: string; display_order: number }[]),
    })),
  };
}
