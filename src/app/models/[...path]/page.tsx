import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { after, connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { TalentCard } from "@/components/TalentCard";
import { ProfileView } from "@/features/public/ProfileView";
import { getPublicBoards, getPublicProfile, getRoster } from "@/features/public/queries";
import { findRedirect } from "@/features/cms/queries";
import { SiteFooter } from "@/components/SiteFooter";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

type Params = { params: Promise<{ path: string[] }> };

// /models/<board path> is a board page; /models/<slug> is a talent profile.
// Board paths win for a single segment; talent slugs carry a random suffix.
async function resolve(segments: string[]) {
  const path = segments.map((segment) => decodeURIComponent(segment).toLowerCase()).join("/");
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(path)) return null;
  const boards = await getPublicBoards();
  const board = boards.find((item) => item.path === path);
  if (board) return { kind: "board" as const, board, boards };
  if (segments.length === 1) {
    const talent = await getPublicProfile(path);
    if (talent) return { kind: "talent" as const, talent };
  }
  return null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await resolve((await params).path);
  if (!found) return { title: "Not found", robots: { index: false } };
  if (found.kind === "board") {
    return { title: found.board.name, description: found.board.description ?? `${found.board.name} — talent represented by 42 Model Management.`, alternates: { canonical: `/models/${found.board.path}` } };
  }
  const { talent } = found;
  const description = talent.bio || `${talent.name}${talent.location ? `, ${talent.location}` : ""} — represented by 42 Model Management.`;
  return {
    title: talent.name,
    description,
    alternates: { canonical: `/models/${talent.slug}` },
    openGraph: { title: `${talent.name} — 42 Model Management`, description, images: talent.image.startsWith("http") ? [{ url: talent.image, alt: talent.imageAlt }] : undefined, type: "profile" },
  };
}

export default async function ModelsPathPage({ params }: Params) {
  // Rendered per request from cached data; staff changes clear the cache (features/public/cache.ts).
  await connection();
  const segments = (await params).path;
  const found = await resolve(segments);
  if (!found) {
    const target = await findRedirect(`/models/${segments.map((segment) => decodeURIComponent(segment)).join("/")}`);
    if (target) {
      after(async () => { await createPublicSupabaseClient().rpc("record_redirect_hit", { p_from_path: target.from_path }); });
      if (target.permanent) permanentRedirect(target.to_path);
      redirect(target.to_path);
    }
    notFound();
  }

  if (found.kind === "talent") {
    const board = found.talent.boards[0];
    const related = board ? (await getRoster({ boardPath: board.path, limit: 7 })).filter((item) => item.id !== found.talent.id).slice(0, 6) : [];
    return <main className="bg-[var(--paper)]">
      <SiteHeader dark />
      <ProfileView talent={found.talent} related={related} backHref={board ? `/models/${board.path}` : "/models"} />
      <SiteFooter />
    </main>;
  }

  const { board, boards } = found;
  const children = boards.filter((item) => item.parent_id === board.id);
  const parent = boards.find((item) => item.id === board.parent_id);
  const talents = await getRoster({ boardPath: board.path });
  return <main className="min-h-screen bg-[var(--paper)]">
    <SiteHeader />
    <section className="container pb-16 pt-32 sm:pb-24 sm:pt-44">
      <Link href={parent ? `/models/${parent.path}` : "/models"} className="label-sm mb-8 inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--ink)]"><ArrowLeft size={14} aria-hidden />{parent ? parent.name : "All talent"}</Link>
      <div className="flex flex-col justify-between gap-8 border-b border-[var(--line)] pb-12 md:flex-row md:items-end">
        <div><p className="label-sm mb-5 text-[var(--muted)]">{parent ? parent.name : "Board"}</p><h1 className="display text-[clamp(56px,10vw,150px)] uppercase leading-[.84] tracking-[-.01em]">{board.name.split(" / ").pop()}</h1></div>
        {board.description && <p className="serif max-w-sm text-[18px] leading-snug text-[var(--muted)]">{board.description}</p>}
      </div>
      {children.length > 0 && <nav aria-label={`${board.name} boards`} className="flex flex-wrap gap-2 pt-8">
        {children.map((child) => <Link key={child.id} href={`/models/${child.path}`} className="label-sm border border-[var(--line)] px-4 py-2.5 hover:border-[var(--ink)]">{child.name.split(" / ").pop()}</Link>)}
      </nav>}
      <h2 className="sr-only">Talent on this board</h2>
      <p className="label-sm pb-8 pt-10 text-[var(--muted)]">{talents.length} {talents.length === 1 ? "talent" : "talents"}</p>
      {talents.length
        ? <div className="grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 lg:grid-cols-4 md:gap-x-5">{talents.map((talent, index) => <TalentCard key={talent.id} talent={talent} index={index} />)}</div>
        : <div className="flex min-h-72 items-center justify-center border border-dashed border-[var(--line)] text-sm text-[var(--muted)]">No talent on this board yet.</div>}
    </section>
    <SiteFooter />
  </main>;
}
