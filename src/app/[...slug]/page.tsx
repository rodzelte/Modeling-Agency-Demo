import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { after, connection } from "next/server";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { isReservedSlug } from "@/features/cms/blocks";
import { Blocks } from "@/features/cms/BlockRenderer";
import { cmsMediaUrl, findRedirect, getPublishedPage } from "@/features/cms/queries";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

type Params = { params: Promise<{ slug: string[] }> };

// Published CMS pages (/about, /privacy, /services/castings …). Anything else is
// checked against Website → Redirects (old-site URLs) before a 404.
function toSlug(segments: string[]) {
  const slug = segments.map((segment) => decodeURIComponent(segment).toLowerCase()).join("/");
  return /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/.test(slug) && !isReservedSlug(slug) ? slug : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const slug = toSlug((await params).slug);
  const page = slug ? await getPublishedPage(slug) : null;
  if (!page) return { title: "Page not found", robots: { index: false } };
  const image = cmsMediaUrl(page.og_image_path);
  return {
    title: page.seo_title || page.title,
    description: page.meta_description ?? undefined,
    alternates: { canonical: `/${page.slug}` },
    robots: page.noindex ? { index: false, follow: true } : undefined,
    openGraph: { title: page.seo_title || page.title, description: page.meta_description ?? undefined, images: image ? [{ url: image }] : undefined, type: "website" },
  };
}

export default async function CmsPage({ params }: Params) {
  await connection();
  const segments = (await params).slug;
  const slug = toSlug(segments);
  const page = slug ? await getPublishedPage(slug) : null;

  if (!page) {
    const path = `/${segments.map((segment) => decodeURIComponent(segment)).join("/")}`;
    const target = await findRedirect(path);
    if (target) {
      after(async () => { await createPublicSupabaseClient().rpc("record_redirect_hit", { p_from_path: target.from_path }); });
      if (target.permanent) permanentRedirect(target.to_path);
      redirect(target.to_path);
    }
    notFound();
  }

  const darkHero = page.sections[0]?.type === "hero" && page.sections[0].data.theme === "dark";
  const hasHero = page.sections[0]?.type === "hero";
  return <main className="min-h-screen bg-[var(--paper)]">
    <SiteHeader dark={darkHero} />
    {!hasHero && <div className="h-[88px]" aria-hidden />}
    <Blocks sections={page.sections} />
    <SiteFooter />
  </main>;
}
