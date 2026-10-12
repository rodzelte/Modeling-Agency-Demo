import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { TalentCard } from "@/components/TalentCard";
import { embedUrl } from "@/features/media/video";
import { CONTACT_EMAIL } from "@/lib/site";
import { PhotoGallery, ViewAllButton } from "./profile/PhotoGallery";
import { ProfileHero } from "./profile/ProfileHero";
import { ProfileTabs } from "./profile/ProfileTabs";
import type { ProfileImage, PublicProfile, TalentCardData } from "./types";

// Public talent profile: full-bleed hero, sticky section tabs, then Portfolio,
// Video, Digitals, Stats and Book. Rendered for live profiles and for staff
// previews, so a preview shows exactly what publishing will show. Sections with
// no content are left out; nothing is invented.
export function ProfileView({ talent, related = [], backHref = "/models" }: { talent: PublicProfile; related?: TalentCardData[]; backHref?: string }) {
  // Digitals are captioned by their alt text when staff set a short one (e.g. "Front", "3/4").
  const caption = (image: ProfileImage) => (image.alt && !image.alt.includes("42 Model Management") && !image.alt.includes(talent.name) && image.alt.length <= 24 ? image.alt : null);
  const books = talent.portfolios.filter((portfolio) => portfolio.kind === "portfolio");
  const digitals = talent.portfolios.filter((portfolio) => portfolio.kind === "digitals").flatMap((portfolio) => portfolio.images);
  // Portfolio: the gallery, or the first book when there is no gallery.
  const portfolio = talent.gallery.length ? talent.gallery : books[0]?.images ?? [];
  const moreBooks = talent.gallery.length ? books : books.slice(1);
  const heroImages = [{ src: talent.image, alt: talent.imageAlt }, ...portfolio.filter((image) => image.src !== talent.image)].slice(0, 3);
  const categories = talent.boards.map((board) => board.name.split(" / ").pop() as string).slice(0, 3);
  const firstName = talent.firstName || talent.name;
  const bookingHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Booking enquiry: ${talent.name}`)}`;

  const tabs = [
    portfolio.length ? { id: "portfolio", label: "Portfolio" } : null,
    talent.videos.length ? { id: "video", label: "Video" } : null,
    digitals.length ? { id: "digitals", label: "Digitals" } : null,
    { id: "stats", label: "Stats" },
    { id: "book", label: "Book" },
  ].filter((tab): tab is { id: string; label: string } => Boolean(tab));

  return <>
    <ProfileHero images={heroImages} name={talent.name} categories={categories} location={talent.location} hasVideo={talent.videos.length > 0} backHref={backHref} />
    <ProfileTabs tabs={tabs} />

    {portfolio.length > 0 && <Section id="portfolio" title="Portfolio" description={`A selection of editorial, commercial and lifestyle work featuring ${firstName}.`}
      mobileAction={<ViewAllButton gallery="portfolio" />}>
      <PhotoGallery id="portfolio" photos={portfolio} label={`${talent.name} portfolio`} />
    </Section>}

    {moreBooks.map((book) => <Section key={book.id} id={`book-${book.id}`} title={book.name} description="From the book." mobileAction={<ViewAllButton gallery={`book-${book.id}`} />}>
      <PhotoGallery id={`book-${book.id}`} photos={book.images} label={`${talent.name}: ${book.name}`} />
    </Section>)}

    {talent.videos.length > 0 && <Section id="video" title="Video" description="Runway, commercial reels and behind the scenes.">
      <div className={`grid gap-4 ${talent.videos.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {talent.videos.map((video) => {
          const embed = video.externalId ? embedUrl(video.provider, video.externalId) : null;
          return <div key={video.id} className="relative aspect-video overflow-hidden bg-[#1a1a19]">
            {embed
              ? <iframe src={embed} title={video.title || `${talent.name} video`} loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen className="absolute inset-0 h-full w-full border-0" />
              : video.src && <video src={video.src} controls preload="metadata" playsInline className="absolute inset-0 h-full w-full object-cover" aria-label={video.title || `${talent.name} video`} />}
          </div>;
        })}
      </div>
    </Section>}

    {digitals.length > 0 && <Section id="digitals" title="Digitals" description="Natural, unretouched images for casting use." mobileAction={<ViewAllButton gallery="digitals" />}>
      <PhotoGallery id="digitals" variant="digitals" photos={digitals.map((image) => ({ ...image, caption: caption(image) }))} label={`${talent.name} digitals`} />
    </Section>}

    <Section id="stats" title="Stats" description={talent.bio || null}>
      {talent.stats.length > 0
        ? <dl className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-5 lg:flex lg:flex-wrap lg:gap-x-12">
            {talent.stats.map((stat) => <div key={stat.label} className="flex min-w-0 flex-col gap-1.5">
              <dt className="label-sm order-2 !text-[9px] text-[var(--muted)] lg:order-1">{stat.label}</dt>
              {/* "6' 2" / 188 cm": imperial large, metric small underneath. */}
              <dd className="order-1 lg:order-2">
                <span className="serif block text-[22px] leading-none sm:text-[24px]">{stat.value.split(" / ")[0]}</span>
                {stat.value.includes(" / ") && <span className="mt-1 block text-[10px] tracking-[.08em] text-[var(--muted)]">{stat.value.split(" / ").slice(1).join(" / ")}</span>}
              </dd>
            </div>)}
          </dl>
        : <p className="serif text-[18px] italic text-[var(--muted)]">Measurements are available on request.</p>}
      {talent.skills.length > 0 && <ul className="mt-10 flex flex-wrap gap-2" aria-label="Skills">{talent.skills.map((skill) => <li key={`${skill.category}-${skill.skill}`} className="label-sm border border-[var(--line)] px-3 py-2 !text-[9px]">
        {skill.skill}{skill.level ? <span className="ml-2 text-[var(--muted)]">{skill.level}</span> : null}
      </li>)}</ul>}
    </Section>

    <section id="book" className="scroll-mt-16 border-t border-[var(--line)]">
      <div className="container flex flex-col items-stretch gap-4 py-12 sm:py-16 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="label-sm text-[var(--muted)]">Book</p>
          <p className="display mt-3 text-[clamp(30px,4vw,48px)] uppercase leading-none">{talent.name}</p>
        </div>
        <div className="flex flex-col items-stretch gap-3 md:items-end">
          <a href={bookingHref} className="label flex items-center justify-center gap-4 bg-[var(--ink)] px-10 py-5 text-white transition-colors hover:bg-[#2c2c2a]">Book {firstName} <ArrowRight size={15} aria-hidden /></a>
          <p className="label-sm text-center !text-[9px] text-[var(--muted)] md:text-right">Inquire at 42 Model Management</p>
        </div>
      </div>
    </section>

    {related.length > 0 && <section className="bg-[var(--cream)] py-16 sm:py-24"><div className="container">
      <div className="mb-10 flex items-end justify-between gap-6 border-b border-[var(--line)] pb-5">
        <h2 className="label">You may also like</h2>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 lg:grid-cols-6 md:gap-x-5">{related.map((item, index) => <TalentCard key={item.id} talent={item} index={index} />)}</div>
    </div></section>}
  </>;
}

// Two columns on desktop (title + note on the left, content on the right);
// on phones the title sits above the content with an optional "View all".
function Section({ id, title, description, mobileAction, children }: { id: string; title: string; description: string | null; mobileAction?: ReactNode; children: ReactNode }) {
  return <section id={id} className="scroll-mt-16 border-b border-[var(--line)]">
    <div className="container grid gap-5 py-10 sm:py-14 lg:grid-cols-[240px_1fr] lg:gap-12">
      <div>
        <div className="flex items-center justify-between gap-4">
          <h2 className="label !text-[13px] !tracking-[.26em] sm:!text-[15px]">{title}</h2>
          {mobileAction && <div className="sm:hidden">{mobileAction}</div>}
        </div>
        <span aria-hidden className="mt-4 hidden h-px w-7 bg-[var(--ink)]/40 lg:block" />
        {description && <p className="serif mt-5 hidden max-w-[220px] text-[16px] leading-[1.45] text-[var(--muted)] lg:block">{description}</p>}
      </div>
      <div className="min-w-0">
        {description && id === "stats" && <p className="serif -mt-1 mb-6 text-[16px] leading-snug text-[var(--muted)] lg:hidden">{description}</p>}
        {children}
      </div>
    </div>
  </section>;
}
