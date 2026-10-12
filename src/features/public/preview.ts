import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";
import { ageFromDob } from "@/lib/format";
import { buildBoardTree, BOARD_COLUMNS, type BoardRow } from "@/features/boards/tree";
import { TALENT_COLUMNS, type TalentCore } from "@/features/talent/types";
import { publicImageUrl, statsFor } from "./queries";
import { PLACEHOLDER_IMAGE, type PublicProfile } from "./types";

type InternalMeasurements = {
  height_cm: number | null; bust_chest_cm: number | null; waist_cm: number | null; hips_cm: number | null; shoe_size_us: string | null;
  suit_size: string | null; inseam_cm: number | null; eye_color: string | null; hair_color: string | null;
};

// Same field names the public view uses (bust_cm, shoe_size).
function toPublicMeasurements(row: InternalMeasurements) {
  const { bust_chest_cm, shoe_size_us, ...rest } = row;
  return { ...rest, bust_cm: bust_chest_cm, shoe_size: shoe_size_us };
}

// Staff preview of the public profile for any talent, whatever its status. It applies
// the same public-safe selection as the public views (migration 017): only images
// marked public, measurements only when shown, age only when enabled.
export async function buildPreviewProfile(supabase: SupabaseClient, permissions: PermissionSet, id: string) {
  const { data: talentData } = await supabase.from("talent").select(TALENT_COLUMNS).eq("id", id).maybeSingle();
  const talent = talentData as unknown as TalentCore | null;
  if (!talent) return null;

  const [photos, measurement, assignments, boards, portfolios, books, videos, skills, privateDetails] = await Promise.all([
    supabase.from("talent_photos").select("id,public_storage_path,alt_text,display_order").eq("talent_id", id).eq("public", true).not("public_storage_path", "is", null).is("archived_at", null).order("featured", { ascending: false }).order("display_order"),
    talent.show_measurements
      ? supabase.from("talent_measurements").select("height_cm,bust_chest_cm,waist_cm,hips_cm,shoe_size_us,suit_size,inseam_cm,eye_color,hair_color").eq("talent_id", id).order("is_official", { ascending: false }).order("measured_on", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("talent_board_assignments").select("board_id").eq("talent_id", id),
    supabase.from("boards").select(BOARD_COLUMNS),
    talent.show_portfolio ? supabase.from("portfolios").select("id,name,display_order,is_default,portfolio_images(photo_id,display_order)").eq("talent_id", id).eq("public", true).order("is_default", { ascending: false }).order("display_order") : Promise.resolve({ data: [] }),
    talent.show_portfolio ? supabase.from("digital_books").select("id,name,display_order,digital_book_images(photo_id,display_order)").eq("talent_id", id).eq("public", true).order("display_order") : Promise.resolve({ data: [] }),
    talent.show_videos ? supabase.from("talent_videos").select("id,title,provider,external_id,public_storage_path").eq("talent_id", id).eq("public", true).is("archived_at", null).order("display_order") : Promise.resolve({ data: [] }),
    supabase.from("talent_skills").select("category,skill,level").eq("talent_id", id).eq("is_public", true).order("category"),
    talent.show_age && permissions.has("talent.private.view") ? supabase.from("talent_private_details").select("date_of_birth").eq("talent_id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const publicPhotos = (photos.data ?? []) as { id: string; public_storage_path: string; alt_text: string | null }[];
  const byId = new Map(publicPhotos.map((photo) => [photo.id, photo]));
  const alt = (value: string | null) => value || `${talent.display_name} — 42 Model Management`;
  const image = (photo: { public_storage_path: string; alt_text: string | null }) => ({ src: publicImageUrl(supabase, photo.public_storage_path), alt: alt(photo.alt_text) });
  const collection = (items: { photo_id: string; display_order: number }[]) => [...items].sort((a, b) => a.display_order - b.display_order).map((item) => byId.get(item.photo_id)).filter((photo): photo is NonNullable<typeof photo> => Boolean(photo)).map(image);

  const tree = buildBoardTree((boards.data ?? []) as BoardRow[]);
  const assigned = new Set((assignments.data ?? []).map((row) => row.board_id as string));
  const [firstName, ...rest] = talent.display_name.split(" ");
  const cover = publicPhotos[0];

  const profile: PublicProfile = {
    id: talent.id,
    slug: talent.slug,
    name: talent.display_name,
    firstName,
    lastName: rest.join(" "),
    location: talent.location ?? "",
    gender: talent.gender ?? "",
    age: talent.show_age ? ageFromDob((privateDetails.data as { date_of_birth: string | null } | null)?.date_of_birth) : null,
    bio: talent.public_bio ?? "",
    image: cover ? publicImageUrl(supabase, cover.public_storage_path) : PLACEHOLDER_IMAGE,
    imageAlt: alt(cover?.alt_text ?? null),
    boards: tree.flat.filter((board) => assigned.has(board.id) && board.isPublic).map((board) => ({ name: board.name, path: board.path })),
    stats: measurement.data ? statsFor(toPublicMeasurements(measurement.data as InternalMeasurements), talent.gender) : [],
    gallery: publicPhotos.map(image),
    portfolios: [
      ...((portfolios.data ?? []) as { id: string; name: string; portfolio_images: { photo_id: string; display_order: number }[] }[]).map((row) => ({ id: row.id, name: row.name, kind: "portfolio" as const, images: collection(row.portfolio_images) })),
      ...((books.data ?? []) as { id: string; name: string; digital_book_images: { photo_id: string; display_order: number }[] }[]).map((row) => ({ id: row.id, name: row.name, kind: "digitals" as const, images: collection(row.digital_book_images) })),
    ].filter((item) => item.images.length),
    videos: ((videos.data ?? []) as { id: string; title: string | null; provider: string; external_id: string | null; public_storage_path: string | null }[])
      .filter((video) => video.provider !== "upload" || video.public_storage_path)
      .map((video) => ({ id: video.id, title: video.title ?? "", provider: video.provider, externalId: video.external_id, src: video.public_storage_path ? publicImageUrl(supabase, video.public_storage_path) : null })),
    skills: (skills.data ?? []) as PublicProfile["skills"],
  };

  const live = talent.publication_status === "published" && talent.show_on_website;
  const warnings = [
    !live && `Not live: status is "${talent.publication_status}"${talent.show_on_website ? "" : " and website visibility is off"}.`,
    !profile.boards.length && "Not on any public board, so it will not appear on board pages or the roster.",
    !publicPhotos.length && "No public images: the profile will show a placeholder. Mark images public in the Media tab.",
    talent.is_minor && talent.consent_status !== "granted" && "Minor without granted guardian consent.",
  ].filter(Boolean) as string[];

  return { profile, live, warnings };
}
