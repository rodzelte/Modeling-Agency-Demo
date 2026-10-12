import type { MetadataRoute } from "next";
import { getSitemapEntries } from "@/features/public/queries";
import { getLivePages } from "@/features/cms/queries";
import { siteOrigin } from "@/lib/site";

export const dynamic = "force-dynamic";

// Only published boards, talent and CMS pages: the public views never return drafts,
// archived, or internal records, so they cannot leak into the sitemap.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteOrigin() ?? "http://localhost:3000";
  const [{ boards, talent }, pages] = await Promise.all([getSitemapEntries(), getLivePages()]);
  return [
    { url: `${site}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${site}/models`, changeFrequency: "daily", priority: 0.9 },
    ...boards.map((board) => ({ url: `${site}/models/${board.path}`, changeFrequency: "daily" as const, priority: 0.8 })),
    ...pages.filter((page) => !page.noindex).map((page) => ({ url: `${site}/${page.slug}`, lastModified: page.published_at, changeFrequency: "monthly" as const, priority: 0.5 })),
    ...talent.map((item) => ({ url: `${site}/models/${item.slug}`, lastModified: item.updated_at, changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
}
