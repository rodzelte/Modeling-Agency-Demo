import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { feetInches, heightLabel, lengthLabel } from "@/lib/format";
import { PLACEHOLDER_IMAGE, type PublicBoard, type PublicProfile, type TalentCardData } from "./types";
import { log } from "@/lib/log";
import { publicCache } from "./cache";
import { boardAndDescendantPaths, cardBoard } from "./board-paths";

// Public website reads. Always the anonymous role through the public-safe views, so
// drafts, archived, internal-only, and private fields can never be returned.
export type TalentRow = {
  id: string; slug: string; display_name: string; location: string | null; gender: string | null; age: number | null;
  featured: boolean; public_bio: string | null; primary_image_path: string | null; primary_image_alt: string | null;
  height_cm: number | null; bust_cm: number | null; waist_cm: number | null; hips_cm: number | null; shoe_size: string | null;
  suit_size: string | null; inseam_cm: number | null; eye_color: string | null; hair_color: string | null;
  show_portfolio: boolean; show_videos: boolean;
  boards: { id: string; name: string; path: string; sort_order: number | null }[] | null; board_paths: string[] | null;
};

export const CARD_COLUMNS = "id,slug,display_name,location,featured,primary_image_path,primary_image_alt,height_cm,boards,board_paths";

export function publicImageUrl(supabase: SupabaseClient, path: string | null) {
  return path ? supabase.storage.from("talent-public").getPublicUrl(path).data.publicUrl : PLACEHOLDER_IMAGE;
}

export function toCard(supabase: SupabaseClient, row: Pick<TalentRow, "id" | "slug" | "display_name" | "location" | "featured" | "primary_image_path" | "primary_image_alt" | "height_cm" | "boards" | "board_paths">, boardPath?: string): TalentCardData {
  const boards = row.boards ?? [];
  const board = cardBoard(boards, boardPath);
  return {
    id: row.id,
    slug: row.slug,
    name: row.display_name,
    location: row.location ?? "",
    height: row.height_cm ? feetInches(row.height_cm) : null,
    boardLabel: board?.name.split(" / ").pop() ?? "",
    image: publicImageUrl(supabase, row.primary_image_path),
    imageAlt: row.primary_image_alt || `${row.display_name} — 42 Model Management`,
    featured: row.featured,
    boardPaths: row.board_paths ?? [],
  };
}

const cachedBoards = publicCache(async (): Promise<PublicBoard[]> => {
  const { data, error } = await createPublicSupabaseClient().from("public_boards_view").select("*").order("depth").order("sort_order").order("name");
  if (error) throw error;
  return (data ?? []) as PublicBoard[];
}, "boards");

export const getPublicBoards = cache(async (): Promise<PublicBoard[]> => {
  try {
    return await cachedBoards();
  } catch (error) {
    log.error("public", "boards query failed", error);
    return [];
  }
});

type RosterOptions = { boardPath?: string; featuredOnly?: boolean; limit?: number };

const cachedRoster = publicCache(async ({ boardPath, featuredOnly = false, limit }: RosterOptions) => {
  const supabase = createPublicSupabaseClient();
  let query = supabase.from("public_talents_view").select(CARD_COLUMNS).neq("board_paths", "{}");
  if (boardPath) query = query.overlaps("board_paths", boardAndDescendantPaths(await cachedBoards(), boardPath));
  if (featuredOnly) query = query.eq("featured", true);
  query = query.order("featured", { ascending: false }).order("display_name");
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as TalentRow[];
  // Board pages follow the order staff set on the assignment, then name; talent
  // who are only on a sub-board come after those placed on the board itself.
  if (boardPath) {
    const position = (row: TalentRow) => row.boards?.find((board) => board.path === boardPath)?.sort_order ?? 100_000;
    rows.sort((a, b) => position(a) - position(b) || a.display_name.localeCompare(b.display_name));
  }
  return rows.map((row) => toCard(supabase, row, boardPath));
}, "roster");

// Talent on at least one public board, optionally a specific board. The full
// /models search (filters and pages) lives in ./search.ts.
export async function getRoster(options: RosterOptions = {}) {
  try {
    return await cachedRoster(options);
  } catch (error) {
    log.error("public", "roster query failed", error);
    return [];
  }
}

export function statsFor(row: Pick<TalentRow, "height_cm" | "bust_cm" | "waist_cm" | "hips_cm" | "shoe_size" | "suit_size" | "inseam_cm" | "eye_color" | "hair_color">, gender: string | null) {
  const chestLabel = gender?.toLowerCase() === "male" ? "Chest" : "Bust";
  return ([
    ["Height", heightLabel(row.height_cm)],
    [chestLabel, lengthLabel(row.bust_cm)],
    ["Waist", lengthLabel(row.waist_cm)],
    ["Hips", lengthLabel(row.hips_cm)],
    ["Inseam", lengthLabel(row.inseam_cm)],
    ["Suit", row.suit_size],
    ["Shoe", row.shoe_size ? `${row.shoe_size} US` : null],
    ["Eyes", row.eye_color],
    ["Hair", row.hair_color],
  ] as [string, string | null][]).filter(([, value]) => value).map(([label, value]) => ({ label, value: value as string }));
}

const cachedProfile = publicCache(async (slug: string): Promise<PublicProfile | null> => {
  const supabase = createPublicSupabaseClient();
  const { data, error } = await supabase.from("public_talents_view").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as TalentRow;
  const [media, portfolios, skills] = await Promise.all([
    supabase.from("public_talent_media_view").select("id,media_type,image_path,title,alt_text,provider,external_id,video_path,display_order,image_type").eq("talent_id", row.id).order("display_order"),
    supabase.from("public_talent_portfolios_view").select("id,kind,name,is_default,display_order,images").eq("talent_id", row.id).order("is_default", { ascending: false }).order("display_order"),
    supabase.from("public_talent_skills_view").select("category,skill,level").eq("talent_id", row.id).order("category"),
  ]);

  type Media = { id: string; media_type: string; image_path: string | null; title: string | null; alt_text: string | null; provider: string | null; external_id: string | null; video_path: string | null; image_type: string | null };
  const items = (media.data ?? []) as Media[];
  const [firstName, ...rest] = row.display_name.split(" ");
  const alt = (value: string | null) => value || `${row.display_name} — 42 Model Management`;
  const images = items.filter((item) => item.media_type === "image" && item.image_path);
  const toImage = (item: { image_path: string | null; alt_text: string | null }) => ({ src: publicImageUrl(supabase, item.image_path), alt: alt(item.alt_text) });
  const looseDigitals = images.filter((item) => item.image_type === "digital");
  const collections = ((portfolios.data ?? []) as { id: string; kind: "portfolio" | "digitals"; name: string; images: { image_path: string; alt_text: string | null }[] }[])
    .filter((portfolio) => portfolio.images.length)
    .map((portfolio) => ({ id: portfolio.id, name: portfolio.name, kind: portfolio.kind, images: portfolio.images.map(toImage) }));

  return {
    id: row.id,
    slug: row.slug,
    name: row.display_name,
    firstName,
    lastName: rest.join(" "),
    location: row.location ?? "",
    gender: row.gender ?? "",
    age: row.age,
    bio: row.public_bio ?? "",
    image: publicImageUrl(supabase, row.primary_image_path),
    imageAlt: alt(row.primary_image_alt),
    boards: (row.boards ?? []).map((board) => ({ name: board.name, path: board.path })),
    stats: statsFor(row, row.gender),
    // Digitals (casting snapshots) get their own section, never the portfolio grid.
    gallery: images.filter((item) => item.image_type !== "digital").map(toImage),
    portfolios: [
      ...collections,
      ...(!collections.some((collection) => collection.kind === "digitals") && looseDigitals.length
        ? [{ id: "digitals", name: "Digitals", kind: "digitals" as const, images: looseDigitals.map(toImage) }] : []),
    ],
    videos: items.filter((item) => item.media_type === "video").map((item) => ({
      id: item.id, title: item.title ?? "", provider: item.provider ?? "", externalId: item.external_id, src: item.video_path ? publicImageUrl(supabase, item.video_path) : null,
    })),
    skills: (skills.data ?? []) as PublicProfile["skills"],
  };
}, "profile");

export const getPublicProfile = cache(async (slug: string): Promise<PublicProfile | null> => {
  try {
    return await cachedProfile(slug);
  } catch (error) {
    log.error("public", "profile query failed", error);
    return null;
  }
});

export async function getSitemapEntries() {
  const supabase = createPublicSupabaseClient();
  const [boards, talent] = await Promise.all([
    getPublicBoards(),
    supabase.from("public_talents_view").select("slug,updated_at"),
  ]);
  return { boards, talent: (talent.data ?? []) as { slug: string; updated_at: string }[] };
}
