import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, ChevronDown } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { TalentCard } from "@/components/TalentCard";
import { cmsMediaUrl, getSiteSettings } from "@/features/cms/queries";
import { getPublicBoards, getRoster } from "@/features/public/queries";
import { PLACEHOLDER_IMAGE } from "@/features/public/types";
import { siteOrigin } from "@/lib/site";

// Two-line display headings: the second line is set in italics.
function Headline({ text }: { text?: string }) {
  const [first, ...rest] = (text ?? "").split("\n");
  return <>{first}{rest.length > 0 && <><br /><em>{rest.join(" ")}</em></>}</>;
}

export default async function Home() {
  // Rendered per request from cached data (see features/public/cache.ts).
  await connection();
  const [publicTalents, settings, boards] = await Promise.all([getRoster({ limit: 8 }), getSiteSettings(), getPublicBoards()]);
  // Hero and About images come from Dashboard → Website → Settings; until they are
  // chosen, the first published talent photo is used, never stock photography.
  const withPhotos = publicTalents.filter((talent) => talent.image !== PLACEHOLDER_IMAGE);
  const talentImage = withPhotos[0]?.image ?? null;
  const heroImage = cmsMediaUrl(settings.home_hero.image_path) ?? talentImage;
  const aboutImage = cmsMediaUrl(settings.home_about.image_path) ?? withPhotos[1]?.image ?? talentImage;
  const topBoards = boards.filter((board) => board.depth === 0);
  const site = siteOrigin() ?? "";
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "42 Model Management",
    url: site || undefined,
    email: settings.contact_email,
    telephone: settings.contact_phone ?? undefined,
    sameAs: settings.instagram_url ? [settings.instagram_url] : undefined,
    areaServed: ["US", "GB"],
  };

  return (
    <main className="overflow-hidden">
      <section className="relative flex h-[100svh] min-h-[600px] max-h-[980px] items-end bg-[var(--ink)] text-white">
        {heroImage && <Image src={heroImage} alt="" fill priority sizes="100vw" className="object-cover object-[center_25%]" />}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/45 md:bg-gradient-to-r md:from-black/75 md:via-black/30 md:to-black/0" />
        <SiteHeader dark />
        <div className="container relative z-10 pb-12 sm:pb-16">
          {settings.home_hero.eyebrow && <p className="label-sm mb-6 text-white/75">{settings.home_hero.eyebrow}</p>}
          <h1 className="display max-w-5xl text-[clamp(58px,11vw,168px)] leading-[.84] tracking-[-.02em]"><Headline text={settings.home_hero.headline} /></h1>
          {settings.home_hero.text && <p className="serif mt-7 max-w-lg text-[19px] leading-snug text-white/80">{settings.home_hero.text}</p>}
          <div className="mt-10 flex flex-col gap-8 border-t border-white/20 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/models" className="label group flex w-fit items-center gap-4">
              Explore talent <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/60 transition-transform group-hover:translate-x-1"><ArrowRight size={16} aria-hidden /></span>
            </Link>
            <div className="label-sm flex items-center gap-6 text-white/60">
              {settings.location_line && <span>{settings.location_line}</span>}
              <a href="#roster" aria-label="Scroll to the roster" className="hidden hover:text-white sm:block"><ChevronDown size={22} strokeWidth={1} aria-hidden /></a>
            </div>
          </div>
        </div>
      </section>

      {topBoards.length > 0 && <nav aria-label="Boards" className="border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="no-scrollbar container flex gap-8 overflow-x-auto sm:justify-center sm:gap-14">
          {[{ href: "/models", label: "All talent" }, ...topBoards.map((board) => ({ href: `/models/${board.path}`, label: board.name }))].map((link) =>
            <Link key={link.href} href={link.href} className="label shrink-0 py-5 text-[var(--muted)] transition-colors hover:text-[var(--ink)]">{link.label}</Link>)}
        </div>
      </nav>}

      <section id="roster" className="scroll-mt-4 bg-[var(--paper)] py-16 sm:py-24">
        <div className="container">
          <div className="mb-10 flex items-end justify-between gap-6 border-b border-[var(--line)] pb-5">
            <div>
              <p className="label-sm mb-3 text-[var(--muted)]">The roster</p>
              <h2 className="display text-[clamp(38px,5vw,64px)] uppercase leading-none">Selected talent</h2>
            </div>
            <Link href="/models" className="label-sm flex shrink-0 items-center gap-2 hover:opacity-60">View all <ArrowRight size={13} aria-hidden /></Link>
          </div>
          {publicTalents.length
            ? <div className="grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-4 md:gap-x-5">{publicTalents.slice(0, 8).map((talent, index) => <TalentCard key={talent.id} talent={talent} index={index} />)}</div>
            : <p className="serif border border-dashed border-[var(--line)] px-6 py-16 text-center text-[18px] italic text-[var(--muted)]">New faces are being added to the roster. <Link href="/models" className="not-italic underline">Browse all talent</Link>.</p>}
        </div>
      </section>

      <section className="border-y border-[var(--line)] bg-[var(--paper)] py-20 sm:py-32">
        <div className="container grid gap-10 lg:grid-cols-[240px_1fr] lg:gap-12">
          <div><p className="label">Our view</p><span aria-hidden className="mt-4 hidden h-px w-7 bg-[var(--ink)]/40 lg:block" /></div>
          <div>
            <h2 className="display max-w-4xl text-[clamp(36px,5.6vw,80px)] leading-[.98] tracking-[-.01em]">We represent <em>distinctive</em> people with something to say.</h2>
            <p className="serif mt-8 max-w-xl text-[19px] leading-[1.5] text-[var(--muted)]">42 is a full-service model management agency built around long-term relationships, sharp creative instinct, and a belief in the individual.</p>
          </div>
        </div>
      </section>

      <section id="about" className="container grid gap-12 py-20 sm:py-32 md:grid-cols-[1fr_1.15fr] md:items-center md:gap-20">
        <div className="relative aspect-[4/5] overflow-hidden bg-[#dcd7cf]">
          {aboutImage
            ? <Image src={aboutImage} alt="" fill sizes="(max-width: 768px) 100vw, 45vw" className="object-cover" />
            : <div className="paper-grid h-full" aria-hidden="true" />}
        </div>
        <div>
          {settings.home_about.eyebrow && <p className="label-sm mb-6 text-[var(--muted)]">{settings.home_about.eyebrow}</p>}
          <h2 className="display max-w-xl text-[clamp(44px,6vw,92px)] leading-[.9] tracking-[-.02em]"><Headline text={settings.home_about.headline} /></h2>
          {settings.home_about.text && <p className="serif mt-8 max-w-md text-[19px] leading-[1.5] text-[var(--muted)]">{settings.home_about.text}</p>}
          <div className="mt-10 flex flex-wrap gap-4">
            <Link href="/#contact" className="label flex items-center gap-3 bg-[var(--ink)] px-8 py-4 text-white hover:bg-[#2c2c2a]">Work with 42 <ArrowRight size={14} aria-hidden /></Link>
            <Link href="/about" className="label flex items-center gap-3 border border-[var(--ink)] px-8 py-4 hover:bg-[var(--ink)] hover:text-white">Our story</Link>
          </div>
        </div>
      </section>

      <section id="contact" className="bg-[var(--ink)] py-20 text-white sm:py-32">
        <div className="container grid gap-14 md:grid-cols-[1.4fr_1fr] md:items-end">
          <div><p className="label-sm mb-7 text-white/60">Start a conversation</p><h2 className="display max-w-3xl text-[clamp(52px,8.5vw,128px)] leading-[.86] tracking-[-.02em]"><Headline text={settings.contact_heading} /></h2></div>
          <div className="serif text-[18px] leading-relaxed text-white/65">
            <p>For bookings, castings and general inquiries:</p>
            <a href={`mailto:${settings.contact_email}`} className="mt-2 inline-block border-b border-white/35 pb-1 text-white">{settings.contact_email}</a>
            {settings.contact_phone && <p className="mt-2"><a href={`tel:${settings.contact_phone.replace(/[^\d+]/g, "")}`} className="text-white">{settings.contact_phone}</a></p>}
            <p className="mt-8">Want to be represented?</p>
            <Link href="/join" prefetch={false} className="label mt-4 flex w-fit items-center gap-3 border border-white/50 px-7 py-4 text-white hover:bg-white hover:text-[var(--ink)]">Apply to join 42 <ArrowRight size={14} aria-hidden /></Link>
          </div>
        </div>
      </section>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization).replace(/</g, "\\u003c") }} />
    </main>
  );
}
