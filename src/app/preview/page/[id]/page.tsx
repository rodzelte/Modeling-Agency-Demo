import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { UnauthorizedState } from "@/components/ui/States";
import { getAgencyContext } from "@/lib/agency-auth";
import { parseSections } from "@/features/cms/blocks";
import { Blocks } from "@/features/cms/BlockRenderer";
import { getEditorPage } from "@/features/cms/queries";

export const metadata: Metadata = { title: "Page preview", robots: { index: false, follow: false } };

// Staff preview of a page's working copy (unpublished edits included).
export default async function PagePreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getAgencyContext();
  if (!context.user) redirect(`/login?next=/preview/page/${id}`);
  if (!context.authorized || !context.permissions.has("website.manage")) return <main className="container py-24"><UnauthorizedState /></main>;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getEditorPage(context.supabase, id);
  if (!data) notFound();
  const parsed = parseSections(data.page.sections);
  const sections = parsed.ok ? parsed.sections : [];
  const first = sections[0];

  return <main className="min-h-screen bg-[var(--paper)]">
    <div role="status" className="fixed inset-x-0 bottom-0 z-40 border-t border-[#20211f] bg-[#20211f] px-4 py-3 text-xs text-white sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2">
        <span className="font-800 uppercase tracking-[.14em] text-[#e4a789]">{data.page.status === "published" && !data.page.has_unpublished_changes ? "Live page preview" : "Draft preview — not public"}</span>
        <span className="text-white/75">/{data.page.slug}</span>
        {!parsed.ok && <span className="text-[#f0b8a3]">{parsed.error}</span>}
        <Link href={`/dashboard/website/pages/${id}`} className="ml-auto rounded-md border border-white/30 px-3 py-1.5 font-800 uppercase tracking-[.12em] hover:bg-white hover:text-[#20211f]">Back to editor</Link>
      </div>
    </div>
    <SiteHeader dark={first?.type === "hero" && first.data.theme === "dark"} />
    {first?.type !== "hero" && <div className="h-[88px]" aria-hidden />}
    <Blocks sections={sections} />
    <SiteFooter />
    <div className="h-16" aria-hidden />
  </main>;
}
