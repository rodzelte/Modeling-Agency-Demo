import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { TalentCard } from "@/components/TalentCard";
import { getPublicBoards } from "@/features/public/queries";
import { searchRoster } from "@/features/public/search";
import { rosterQuery } from "@/features/public/filters";
import { videoEmbed, type BlockData, type Section } from "./blocks";
import { Markdown } from "./Markdown";
import { cmsMediaUrl, getSiteSettings } from "./queries";
import { sanitizeBlockHtml, scopeBlockCss } from "./sanitize";

// Renders validated CMS sections on the public site (and in staff previews).
// Every block is server-rendered; custom HTML is sanitised again at render time.

function Button({ href, label, dark }: { href: string; label: string; dark?: boolean }) {
  const external = href.startsWith("https://");
  const className = `inline-flex w-fit items-center gap-3 border-b pb-2 text-[11px] font-800 uppercase tracking-[.18em] ${dark ? "border-white/60" : "border-[var(--ink)]"}`;
  return external
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{label}<ArrowUpRight size={15} aria-hidden /></a>
    : <Link href={href} className={className} prefetch={href === "/join" ? false : undefined}>{label}<ArrowUpRight size={15} aria-hidden /></Link>;
}

function Hero({ data, first }: { data: BlockData<"hero">; first: boolean }) {
  const image = cmsMediaUrl(data.image_path);
  const dark = data.theme === "dark";
  return <section className={`relative flex min-h-[min(720px,90vh)] items-end ${dark ? "bg-[var(--ink)] text-white" : "bg-[var(--cream)] text-[var(--ink)]"}`}>
    {image && <><Image src={image} alt="" fill priority={first} sizes="100vw" className="object-cover" /><div className={`absolute inset-0 ${dark ? "bg-gradient-to-t from-black/70 via-black/25 to-black/10" : "bg-gradient-to-t from-[var(--cream)]/90 via-[var(--cream)]/40 to-transparent"}`} /></>}
    <div className="container relative pb-16 pt-40 sm:pb-24">
      {data.eyebrow && <p className="eyebrow mb-6 opacity-80">{data.eyebrow}</p>}
      {first ? <h1 className="display max-w-4xl text-[clamp(52px,9vw,128px)] leading-[.85] tracking-[-.045em]">{data.heading}</h1>
        : <h2 className="display max-w-4xl text-[clamp(44px,7vw,104px)] leading-[.88] tracking-[-.04em]">{data.heading}</h2>}
      {data.text && <p className="mt-8 max-w-xl text-[15px] leading-7 opacity-80">{data.text}</p>}
      {data.cta_label && data.cta_href && <div className="mt-10"><Button href={data.cta_href} label={data.cta_label} dark={dark} /></div>}
    </div>
  </section>;
}

function RichText({ data, first }: { data: BlockData<"rich_text">; first: boolean }) {
  return <section className="container py-16 sm:py-24">
    <div className="mx-auto max-w-2xl">
      {data.heading && (first ? <h1 className="display mb-10 text-[clamp(48px,8vw,96px)] leading-[.9] tracking-[-.04em]">{data.heading}</h1> : <h2 className="display mb-8 text-[clamp(36px,5vw,64px)] leading-none tracking-[-.03em]">{data.heading}</h2>)}
      <Markdown source={data.body} />
    </div>
  </section>;
}

function ImageBlock({ data }: { data: BlockData<"image"> }) {
  const src = cmsMediaUrl(data.image_path);
  if (!src) return null;
  const width = data.width === "full" ? "" : data.width === "wide" ? "container" : "container max-w-3xl";
  return <figure className={`${width} py-10`}>
    <div className="relative aspect-[16/10] overflow-hidden bg-[var(--cream)]"><Image src={src} alt={data.alt} fill sizes={data.width === "normal" ? "(max-width: 800px) 100vw, 760px" : "100vw"} className="object-cover" /></div>
    {data.caption && <figcaption className="mt-3 text-[11px] uppercase tracking-[.14em] text-[var(--muted)]">{data.caption}</figcaption>}
  </figure>;
}

function Video({ data }: { data: BlockData<"video"> }) {
  const src = videoEmbed(data.url);
  if (!src) return null;
  return <section className="container py-10"><div className="relative aspect-video overflow-hidden bg-black">
    <iframe src={src} title={data.title ?? "Video"} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 h-full w-full" />
  </div>{data.title && <p className="mt-3 text-[11px] uppercase tracking-[.14em] text-[var(--muted)]">{data.title}</p>}</section>;
}

function Cta({ data }: { data: BlockData<"cta"> }) {
  const dark = data.theme === "dark";
  return <section className={dark ? "bg-[var(--ink)] text-white" : "bg-[var(--cream)]"}>
    <div className="container flex flex-col gap-8 py-20 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl"><h2 className="display text-[clamp(40px,6vw,80px)] leading-[.9] tracking-[-.04em]">{data.heading}</h2>{data.text && <p className="mt-5 text-[15px] leading-7 opacity-75">{data.text}</p>}</div>
      <Button href={data.href} label={data.label} dark={dark} />
    </div>
  </section>;
}

async function TalentGrid({ data }: { data: BlockData<"talent_grid"> }) {
  const result = await searchRoster({ board: data.board, sort: data.sort === "featured" ? undefined : data.sort });
  const talents = (data.featured_only ? result.talents.filter((talent) => talent.featured) : result.talents).slice(0, data.limit);
  const more = data.board ? `/models/${data.board}` : `/models${rosterQuery({ sort: data.sort === "featured" ? undefined : data.sort })}`;
  return <section className="container py-16 sm:py-24">
    {(data.heading || data.show_link) && <div className="mb-10 flex items-end justify-between gap-6 border-b border-[var(--line)] pb-6">
      {data.heading && <h2 className="display text-[clamp(36px,5vw,64px)] leading-none tracking-[-.03em]">{data.heading}</h2>}
      {data.show_link && <Link href={more} className="text-[10px] font-800 uppercase tracking-[.16em]">View all ↗</Link>}
    </div>}
    {talents.length ? <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4 md:gap-x-6">{talents.map((talent, index) => <TalentCard key={talent.id} talent={talent} index={index} />)}</div>
      : <p className="border border-dashed border-[var(--line)] px-6 py-12 text-center text-sm text-[var(--muted)]">New faces are being added. <Link href="/models" className="underline">Browse all talent</Link>.</p>}
  </section>;
}

async function BoardGrid({ data }: { data: BlockData<"board_grid"> }) {
  const boards = await getPublicBoards();
  const parent = data.parent ? boards.find((board) => board.path === data.parent) : null;
  const list = boards.filter((board) => (parent ? board.parent_id === parent.id : board.depth === 0));
  if (!list.length) return null;
  return <section className="container py-16 sm:py-24">
    {data.heading && <h2 className="display mb-10 text-[clamp(36px,5vw,64px)] leading-none tracking-[-.03em]">{data.heading}</h2>}
    <ul className="grid grid-cols-1 border-t border-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">{list.map((board) => <li key={board.id} className="border-b border-[var(--line)] sm:odd:border-r lg:border-r lg:[&:nth-child(3n)]:border-r-0">
      <Link href={`/models/${board.path}`} className="group flex items-center justify-between gap-4 px-1 py-7 sm:px-6"><span className="display text-4xl leading-none">{board.name.split(" / ").pop()}</span><ArrowUpRight size={18} className="transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" aria-hidden /></Link>
    </li>)}</ul>
  </section>;
}

async function Contact({ data }: { data: BlockData<"contact"> }) {
  const settings = await getSiteSettings();
  return <section className="bg-[var(--ink)] text-white"><div className="container grid gap-10 py-20 md:grid-cols-2">
    <div>{data.heading && <h2 className="display text-[clamp(40px,6vw,80px)] leading-[.9] tracking-[-.04em]">{data.heading}</h2>}{data.text && <p className="mt-5 max-w-md text-[15px] leading-7 text-white/70">{data.text}</p>}</div>
    <div className="space-y-3 text-sm text-white/70">
      <a href={`mailto:${settings.contact_email}`} className="block w-fit border-b border-white/35 pb-1 text-white">{settings.contact_email}</a>
      {settings.contact_phone && <a href={`tel:${settings.contact_phone.replace(/[^\d+]/g, "")}`} className="block w-fit">{settings.contact_phone}</a>}
      {settings.instagram_url && <a href={settings.instagram_url} target="_blank" rel="noopener noreferrer" className="block w-fit">Instagram ↗</a>}
      {settings.location_line && <p className="pt-4">{settings.location_line}</p>}
    </div>
  </div></section>;
}

function Html({ id, data }: { id: string; data: BlockData<"html"> }) {
  const css = data.css ? scopeBlockCss(data.css, id) : "";
  return <section className="container py-10" data-cms-block={id}>
    {css && <style>{css}</style>}
    <div dangerouslySetInnerHTML={{ __html: sanitizeBlockHtml(data.html) }} />
  </section>;
}

export function Blocks({ sections }: { sections: Section[] }) {
  return <>{sections.map((section, index) => {
    const first = index === 0;
    switch (section.type) {
      case "hero": return <Hero key={section.id} data={section.data} first={first} />;
      case "rich_text": return <RichText key={section.id} data={section.data} first={first} />;
      case "image": return <ImageBlock key={section.id} data={section.data} />;
      case "video": return <Video key={section.id} data={section.data} />;
      case "cta": return <Cta key={section.id} data={section.data} />;
      case "talent_grid": return <TalentGrid key={section.id} data={section.data} />;
      case "board_grid": return <BoardGrid key={section.id} data={section.data} />;
      case "contact": return <Contact key={section.id} data={section.data} />;
      case "html": return <Html key={section.id} id={section.id} data={section.data} />;
      default: return null;
    }
  })}</>;
}
