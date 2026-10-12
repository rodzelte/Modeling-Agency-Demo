import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { UnauthorizedState } from "@/components/ui/States";
import { getAgencyContext } from "@/lib/agency-auth";
import { ProfileView } from "@/features/public/ProfileView";
import { buildPreviewProfile } from "@/features/public/preview";

export const metadata: Metadata = { title: "Profile preview", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ProfilePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getAgencyContext();
  if (!context.user) redirect(`/login?next=/preview/talent/${id}`);
  if (!context.authorized || !context.permissions.has("talent.view")) return <main className="container py-24"><UnauthorizedState /></main>;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const preview = await buildPreviewProfile(context.supabase, context.permissions, id);
  if (!preview) notFound();

  return <main className="bg-[var(--paper)]">
    <div role="status" className="fixed inset-x-0 bottom-0 z-40 border-t border-[#20211f] bg-[#20211f] px-4 py-3 text-xs text-white sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2">
        <span className="font-800 uppercase tracking-[.14em] text-[#e4a789]">{preview.live ? "Live profile preview" : "Draft preview — not public"}</span>
        {preview.warnings.map((warning) => <span key={warning} className="text-white/75">{warning}</span>)}
        <Link href={`/dashboard/talent/${id}`} className="ml-auto rounded-md border border-white/30 px-3 py-1.5 font-800 uppercase tracking-[.12em] hover:bg-white hover:text-[#20211f]">Back to record</Link>
      </div>
    </div>
    <SiteHeader dark />
    <ProfileView talent={preview.profile} backHref={`/dashboard/talent/${id}`} />
    <div className="h-24" aria-hidden />
  </main>;
}
