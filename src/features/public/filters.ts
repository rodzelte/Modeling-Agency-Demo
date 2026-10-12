import { z } from "zod";

// Roster filter definitions shared by the server search (search.ts) and the
// client filter bar. Pure: no Supabase or Next.js server imports.
export const PAGE_SIZE = 24;
export const CM_PER_INCH = 2.54;

const text = (max: number) => z.string().trim().max(200).transform((value) => value.replace(/[^\p{L}\p{N} .'&/-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max)).optional()
  .transform((value) => value || undefined);
const bounded = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional().catch(undefined);

export const rosterFilterSchema = z.object({
  q: text(60),
  board: z.string().trim().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/).max(200).optional().catch(undefined),
  gender: text(30),
  ageMin: bounded(0, 99),
  ageMax: bounded(0, 99),
  heightMin: bounded(100, 230), // cm
  heightMax: bounded(100, 230),
  waistMax: bounded(15, 60), // inches
  hipsMax: bounded(20, 70),
  hair: text(40),
  eyes: text(40),
  location: text(60),
  skill: text(60),
  portfolio: text(60),
  sort: z.enum(["featured", "name", "newest"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(500).optional().catch(undefined),
});

export type RosterFilters = Partial<z.infer<typeof rosterFilterSchema>>;
export type FilterKey = Exclude<keyof RosterFilters, "page">;

export function parseRosterFilters(params: Record<string, string | string[] | undefined>): RosterFilters {
  const flat = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]).filter(([, value]) => value !== ""));
  const parsed = rosterFilterSchema.safeParse(flat);
  // Drop unset keys so equal searches share one cache entry.
  return parsed.success ? Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)) as RosterFilters : {};
}

// The canonical query string for a set of filters (stable order, defaults dropped).
export function rosterQuery(filters: RosterFilters, overrides: Partial<RosterFilters> = {}) {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  for (const key of Object.keys(rosterFilterSchema.shape) as (keyof RosterFilters)[]) {
    const value = merged[key];
    if (value === undefined || value === null || value === "") continue;
    if (key === "page" && value === 1) continue;
    if (key === "sort" && value === "featured") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function activeFilterCount(filters: RosterFilters) {
  return (Object.keys(filters) as (keyof RosterFilters)[]).filter((key) => !["page", "sort"].includes(key) && filters[key] !== undefined).length;
}

