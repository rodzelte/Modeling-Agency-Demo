import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { feetInches, lengthLabel } from "@/lib/format";
import { hashShareToken, isShareToken } from "@/features/packages/share";
import { getSiteSettings } from "@/features/cms/queries";

// Client-facing package view. Private link: never indexed, never cached.
export const metadata: Metadata = { title: "Talent package", robots: { index: false, follow: false, nocache: true } };

type Shared = {
  title: string; message: string | null; expires_at: string | null;
  talent: { id: string; name: string; location: string | null; gender: string | null; note: string | null; profile_slug: string | null;
    measurements: { height_cm?: number; bust_cm?: number; waist_cm?: number; hips_cm?: number; shoe_size?: number; suit_size?: string; hair_color?: string; eye_color?: string } | null;
    photos: { path: string; alt: string | null }[] }[];
};

export default async function SharedPackage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  if (!isShareToken(token)) notFound();
  const supabase = createPublicSupabaseClient();
  const [{ data }, settings] = await Promise.all([supabase.rpc("get_shared_package", { p_token_hash: hashShareToken(token) }), getSiteSettings()]);
  if (!data) notFound();
  const pkg = data as Shared;
  const url = (path: string) => supabase.storage.from("talent-public").getPublicUrl(path).data.publicUrl;

  return <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
    <header className="border-b border-[var(--line)]">
      <div className="container flex h-20 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-current text-[11px] font-800 tracking-[-.08em]">42</span><span className="text-[11px] font-800 uppercase tracking-[.18em]">Model Management</span></Link>
        <a href={`mailto:${settings.contact_email}?subject=${encodeURIComponent(pkg.title)}`} className="text-[10px] font-800 uppercase tracking-[.16em] underline-offset-4 hover:underline">{settings.contact_email}</a>
      </div>
    </header>
    <section className="container py-14 sm:py-20">
      <p className="eyebrow text-[var(--accent)]">Selected for you</p>
      <h1 className="display mt-4 text-[clamp(44px,8vw,100px)] leading-[.9] tracking-[-.04em]">{pkg.title}</h1>
      {pkg.message && <p className="mt-6 max-w-2xl whitespace-pre-line text-[15px] leading-7 text-[var(--muted)]">{pkg.message}</p>}
      {pkg.expires_at && <p className="mt-6 text-[11px] uppercase tracking-[.14em] text-[var(--muted)]">Available until {new Date(pkg.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>}
    </section>
    <div className="container space-y-20 pb-24">
      {pkg.talent.map((talent, index) => {
        const m = talent.measurements;
        const stats = m ? [["Height", m.height_cm ? feetInches(m.height_cm) : null], ["Bust", lengthLabel(m.bust_cm)], ["Waist", lengthLabel(m.waist_cm)], ["Hips", lengthLabel(m.hips_cm)], ["Shoe", m.shoe_size ? `${m.shoe_size} US` : null], ["Suit", m.suit_size ?? null], ["Hair", m.hair_color ?? null], ["Eyes", m.eye_color ?? null]].filter(([, value]) => value) as [string, string][] : [];
        return <article key={talent.id} className="border-t border-[var(--line)] pt-10">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="text-[10px] font-800 uppercase tracking-[.16em] text-[var(--muted)]">{String(index + 1).padStart(2, "0")}</p>
              <h2 className="display mt-2 text-5xl leading-none">{talent.name}</h2>
              {talent.location && <p className="mt-2 text-[11px] font-700 uppercase tracking-[.14em] text-[var(--muted)]">{talent.location}</p>}
              {talent.note && <p className="mt-4 max-w-xl text-sm leading-6">{talent.note}</p>}
            </div>
            {stats.length > 0 && <dl className="grid grid-cols-4 gap-x-6 gap-y-2 text-xs">{stats.map(([label, value]) => <div key={label}><dt className="text-[9px] font-800 uppercase tracking-[.14em] text-[var(--muted)]">{label}</dt><dd className="mt-0.5 font-700">{value}</dd></div>)}</dl>}
          </div>
          {talent.photos.length ? <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">{talent.photos.map((photo, photoIndex) => <div key={photo.path} className="relative aspect-[3/4] overflow-hidden bg-[var(--cream)]">
            <Image src={url(photo.path)} alt={photo.alt || `${talent.name} — photo ${photoIndex + 1}`} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover" loading={index === 0 && photoIndex < 4 ? "eager" : "lazy"} />
          </div>)}</div> : <p className="mt-8 text-sm text-[var(--muted)]">Photos available on request.</p>}
          {talent.profile_slug && <Link href={`/models/${talent.profile_slug}`} className="mt-5 inline-block text-[10px] font-800 uppercase tracking-[.16em] underline-offset-4 hover:underline">Full portfolio ↗</Link>}
        </article>;
      })}
      {pkg.talent.length === 0 && <p className="text-sm text-[var(--muted)]">This package is being updated. Please check back soon.</p>}
    </div>
    <footer className="border-t border-[var(--line)] py-8 text-center text-[10px] font-700 uppercase tracking-[.15em] text-[var(--muted)]">© {new Date().getFullYear()} 42 Model Management · Private selection — please do not forward</footer>
  </main>;
}
