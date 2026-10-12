import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { log } from "@/lib/log";
import { publicCache } from "./cache";
import { CARD_COLUMNS, getPublicBoards, toCard, type TalentRow } from "./queries";
import type { PublicBoard, TalentCardData } from "./types";
import { CM_PER_INCH, PAGE_SIZE, type RosterFilters } from "./filters";

// Public roster search. Every filter runs against public_talents_view (and the
// public skills/portfolio views), where hidden values are already NULL: a talent
// who hides measurements or age simply never matches those filters, so repeated
// searches cannot reveal a hidden value.

// A board filter matches the board and everything beneath it.
function pathsUnder(boards: PublicBoard[], path: string) {
  return boards.map((board) => board.path).filter((candidate) => candidate === path || candidate.startsWith(`${path}/`));
}

async function talentIdsFrom(view: "public_talent_skills_view" | "public_talent_portfolios_view", column: "skill" | "name", value: string) {
  const { data, error } = await createPublicSupabaseClient().from(view).select("talent_id").ilike(column, value).limit(5000);
  if (error) throw error;
  return [...new Set((data ?? []).map((row: { talent_id: string }) => row.talent_id))];
}

export type RosterPage = { talents: TalentCardData[]; total: number; page: number; pageCount: number };

const cachedSearch = publicCache(async (filters: RosterFilters, boardPaths: string[] | null): Promise<RosterPage> => {
  const page = filters.page ?? 1;
  const empty = { talents: [], total: 0, page, pageCount: 1 };
  const supabase = createPublicSupabaseClient();
  let query = supabase.from("public_talents_view").select(CARD_COLUMNS, { count: "exact" }).neq("board_paths", "{}");

  if (boardPaths) {
    if (!boardPaths.length) return empty;
    query = query.overlaps("board_paths", boardPaths);
  }
  if (filters.q) query = query.or(`display_name.ilike.%${filters.q}%,location.ilike.%${filters.q}%`);
  if (filters.gender) query = query.ilike("gender", filters.gender);
  if (filters.location) query = query.ilike("location", `%${filters.location}%`);
  if (filters.hair) query = query.ilike("hair_color", filters.hair);
  if (filters.eyes) query = query.ilike("eye_color", filters.eyes);
  if (filters.ageMin !== undefined) query = query.gte("age", filters.ageMin);
  if (filters.ageMax !== undefined) query = query.lte("age", filters.ageMax);
  if (filters.heightMin !== undefined) query = query.gte("height_cm", filters.heightMin);
  if (filters.heightMax !== undefined) query = query.lte("height_cm", filters.heightMax);
  if (filters.waistMax !== undefined) query = query.lte("waist_cm", filters.waistMax * CM_PER_INCH + 0.5);
  if (filters.hipsMax !== undefined) query = query.lte("hips_cm", filters.hipsMax * CM_PER_INCH + 0.5);

  let ids: string[] | null = null;
  if (filters.skill) ids = await talentIdsFrom("public_talent_skills_view", "skill", filters.skill);
  if (filters.portfolio) {
    const portfolioIds = await talentIdsFrom("public_talent_portfolios_view", "name", filters.portfolio);
    ids = ids ? ids.filter((id) => portfolioIds.includes(id)) : portfolioIds;
  }
  if (ids) {
    if (!ids.length) return empty;
    query = query.in("id", ids.slice(0, 1000));
  }

  if (filters.sort === "name") query = query.order("display_name");
  else if (filters.sort === "newest") query = query.order("updated_at", { ascending: false }).order("display_name");
  else query = query.order("featured", { ascending: false }).order("display_name");

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);
  // PostgREST answers 416 when the page is past the end.
  if (error && error.code === "PGRST103") return { ...empty, total: count ?? 0 };
  if (error) throw error;
  const total = count ?? 0;
  const boardPath = filters.board;
  return {
    talents: ((data ?? []) as unknown as TalentRow[]).map((row) => toCard(supabase, row, boardPath)),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}, "roster-search");

export async function searchRoster(filters: RosterFilters): Promise<RosterPage> {
  try {
    const boardPaths = filters.board ? pathsUnder(await getPublicBoards(), filters.board) : null;
    return await cachedSearch(filters, boardPaths);
  } catch (error) {
    log.error("public", "roster search failed", error);
    return { talents: [], total: 0, page: filters.page ?? 1, pageCount: 1 };
  }
}

export type FilterOptions = { genders: string[]; hair: string[]; eyes: string[]; skills: string[]; portfolios: string[] };

// Option lists come from what is actually published, de-duplicated case-insensitively.
const cachedOptions = publicCache(async (): Promise<FilterOptions> => {
  const supabase = createPublicSupabaseClient();
  const [talent, skills, portfolios] = await Promise.all([
    supabase.from("public_talents_view").select("gender,hair_color,eye_color").neq("board_paths", "{}").limit(5000),
    supabase.from("public_talent_skills_view").select("skill").limit(5000),
    supabase.from("public_talent_portfolios_view").select("name").eq("kind", "portfolio").limit(5000),
  ]);
  for (const result of [talent, skills, portfolios]) if (result.error) throw result.error;
  const distinct = (values: (string | null | undefined)[]) => {
    const seen = new Map<string, string>();
    for (const value of values) {
      const clean = value?.trim();
      if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  };
  const rows = (talent.data ?? []) as { gender: string | null; hair_color: string | null; eye_color: string | null }[];
  return {
    genders: distinct(rows.map((row) => row.gender)),
    hair: distinct(rows.map((row) => row.hair_color)),
    eyes: distinct(rows.map((row) => row.eye_color)),
    skills: distinct(((skills.data ?? []) as { skill: string }[]).map((row) => row.skill)),
    portfolios: distinct(((portfolios.data ?? []) as { name: string }[]).map((row) => row.name)),
  };
}, "roster-options");

export async function getFilterOptions(): Promise<FilterOptions> {
  try {
    return await cachedOptions();
  } catch (error) {
    log.error("public", "filter options failed", error);
    return { genders: [], hair: [], eyes: [], skills: [], portfolios: [] };
  }
}
