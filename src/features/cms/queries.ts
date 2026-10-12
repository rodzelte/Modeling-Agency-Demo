import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { log } from "@/lib/log";
import { CONTACT_EMAIL } from "@/lib/site";
import { publicCache } from "@/features/public/cache";
import { parseSections, type Section } from "./blocks";

// Public CMS reads (anonymous role, public views, cached under the public-site
// tag) and staff reads for the editor (caller's session, RLS applies).

export type SiteSettings = {
  contact_email: string;
  contact_phone: string | null;
  instagram_url: string | null;
  location_line: string | null;
  home_hero: { eyebrow?: string; headline?: string; text?: string | null; image_path?: string | null };
  home_about: { eyebrow?: string; headline?: string; text?: string | null; image_path?: string | null };
  contact_heading: string;
};

export const SETTINGS_DEFAULTS: SiteSettings = {
  contact_email: CONTACT_EMAIL,
  contact_phone: null,
  instagram_url: null,
  location_line: "Dallas–Fort Worth · USA – UK",
  home_hero: { eyebrow: "Independent talent / Dallas–Fort Worth", headline: "The faces\nof now.", text: null, image_path: null },
  home_about: { eyebrow: "More than a roster", headline: "People first.\nAlways.", text: "From first digitals to global campaigns, we help talent build meaningful careers and give clients access to a roster with range, intention, and staying power.", image_path: null },
  contact_heading: "Let's make\nsomething real.",
};

export type NavItem = { id: string; label: string; href: string; location: "header" | "footer"; sort_order: number };
export type PublishedPage = { id: string; slug: string; title: string; seo_title: string | null; meta_description: string | null; og_image_path: string | null; noindex: boolean; sections: Section[]; published_at: string };

export function cmsMediaUrl(path: string | null | undefined) {
  if (!path) return null;
  return createPublicSupabaseClient().storage.from("cms-media").getPublicUrl(path).data.publicUrl;
}

async function safely<T>(label: string, fallback: T, run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    log.error("cms", `${label} failed`, error);
    return fallback;
  }
}

const cachedSettings = publicCache(async (): Promise<SiteSettings> => {
  const { data, error } = await createPublicSupabaseClient().from("public_settings_view").select("key,value");
  if (error) throw error;
  const values = Object.fromEntries(((data ?? []) as { key: string; value: unknown }[]).map((row) => [row.key, row.value]));
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    contact_email: str(values.contact_email) ?? SETTINGS_DEFAULTS.contact_email,
    contact_phone: str(values.contact_phone),
    instagram_url: str(values.instagram_url)?.startsWith("https://") ? str(values.instagram_url) : null,
    location_line: str(values.location_line) ?? SETTINGS_DEFAULTS.location_line,
    home_hero: { ...SETTINGS_DEFAULTS.home_hero, ...(values.home_hero as object ?? {}) },
    home_about: { ...SETTINGS_DEFAULTS.home_about, ...(values.home_about as object ?? {}) },
    contact_heading: str(values.contact_heading) ?? SETTINGS_DEFAULTS.contact_heading,
  };
}, "cms-settings");
export const getSiteSettings = cache(() => safely("settings", SETTINGS_DEFAULTS, cachedSettings));

const cachedNavigation = publicCache(async (): Promise<NavItem[]> => {
  const { data, error } = await createPublicSupabaseClient().from("public_navigation_view").select("id,label,href,location,sort_order").order("sort_order");
  if (error) throw error;
  return (data ?? []) as NavItem[];
}, "cms-navigation");

const cachedLiveSlugs = publicCache(async (): Promise<{ slug: string; published_at: string; noindex: boolean }[]> => {
  const { data, error } = await createPublicSupabaseClient().from("public_pages_view").select("slug,published_at,noindex");
  if (error) throw error;
  return (data ?? []) as { slug: string; published_at: string; noindex: boolean }[];
}, "cms-slugs");
export const getLivePages = cache(() => safely("live pages", [], cachedLiveSlugs));

// Links to CMS pages that are not live are hidden, so the menu never 404s.
const APP_PATHS = /^\/($|#|models(\/|$|\?)|join$|login$)/;
export const getNavigation = cache(async () => {
  const [items, live] = await Promise.all([safely("navigation", [], cachedNavigation), getLivePages()]);
  const liveSlugs = new Set(live.map((page) => page.slug));
  const visible = items.filter((item) => !item.href.startsWith("/") || APP_PATHS.test(item.href) || liveSlugs.has(item.href.slice(1).split(/[?#]/)[0]));
  return { header: visible.filter((item) => item.location === "header"), footer: visible.filter((item) => item.location === "footer"), liveSlugs };
});

const cachedPage = publicCache(async (slug: string): Promise<PublishedPage | null> => {
  const { data, error } = await createPublicSupabaseClient().from("public_pages_view").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Re-validate on read: a row written outside the editor still renders safely.
  const parsed = parseSections(data.sections);
  return { ...(data as PublishedPage), sections: parsed.ok ? parsed.sections : [] };
}, "cms-page");
export const getPublishedPage = cache((slug: string) => safely("page", null, () => cachedPage(slug)));

const cachedRedirects = publicCache(async (): Promise<{ from_path: string; to_path: string; permanent: boolean }[]> => {
  const { data, error } = await createPublicSupabaseClient().from("website_redirects").select("from_path,to_path,permanent").eq("is_active", true).limit(2000);
  if (error) throw error;
  return (data ?? []) as { from_path: string; to_path: string; permanent: boolean }[];
}, "cms-redirects");
export async function findRedirect(path: string) {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "").toLowerCase() : path;
  const redirects = await safely("redirects", [], cachedRedirects);
  return redirects.find((item) => item.from_path.replace(/\/+$/, "").toLowerCase() === normalized) ?? null;
}

// ---------------------------------------------------------------------------
// Staff (editor) reads
// ---------------------------------------------------------------------------
export type EditorPage = {
  id: string; slug: string; title: string; seo_title: string | null; meta_description: string | null; og_image_path: string | null;
  noindex: boolean; sections: unknown; status: "draft" | "published" | "archived"; published_at: string | null;
  has_unpublished_changes: boolean; updated_at: string;
};

export async function listEditorPages(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("website_pages").select("id,slug,title,status,published_at,has_unpublished_changes,updated_at").order("slug");
  if (error) throw error;
  return (data ?? []) as Pick<EditorPage, "id" | "slug" | "title" | "status" | "published_at" | "has_unpublished_changes" | "updated_at">[];
}

export async function getEditorPage(supabase: SupabaseClient, id: string) {
  const [page, revisions] = await Promise.all([
    supabase.from("website_pages").select("id,slug,title,seo_title,meta_description,og_image_path,noindex,sections,status,published_at,has_unpublished_changes,updated_at").eq("id", id).maybeSingle(),
    supabase.from("website_page_revisions").select("id,version,title,published_at,published_by").eq("page_id", id).order("version", { ascending: false }).limit(30),
  ]);
  if (page.error) throw page.error;
  if (!page.data) return null;
  return { page: page.data as EditorPage, revisions: (revisions.data ?? []) as { id: string; version: number; title: string; published_at: string }[] };
}

export async function listCmsMedia(supabase: SupabaseClient) {
  const { data, error } = await supabase.storage.from("cms-media").list("cms", { limit: 200, sortBy: { column: "created_at", order: "desc" } });
  if (error) throw error;
  return (data ?? []).filter((item) => item.id).map((item) => ({ path: `cms/${item.name}`, url: cmsMediaUrl(`cms/${item.name}`) as string, size: (item.metadata?.size as number | undefined) ?? null }));
}
