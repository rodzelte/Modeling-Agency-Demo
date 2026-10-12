"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Play } from "lucide-react";
import { PHOTO_QUALITY, type ProfileImage } from "../types";

const pad = (value: number) => String(value).padStart(2, "0");

// Hero. Model photos are portraits, so a single one stretched across a wide
// screen is cropped and enlarged until it looks soft. On wider screens the hero
// is an editorial spread instead: up to three portraits side by side, each shown
// at roughly its own size, which together fill the landscape banner with no
// cropping of faces. Phones show one portrait at a time, cross-fading every 6
// seconds (paused while hovered or focused, never with reduced motion).
export function ProfileHero({ images, name, categories, location, hasVideo, backHref }: {
  images: ProfileImage[]; name: string; categories: string[]; location: string; hasVideo: boolean; backHref: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = images.length;
  const spread = images.slice(0, 3);

  useEffect(() => {
    if (count < 2 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), 6000);
    return () => window.clearInterval(timer);
  }, [count, paused]);

  return <section aria-label={`${name}, cover photos`} className="relative h-[86svh] min-h-[560px] overflow-hidden bg-[var(--ink)] text-white md:h-[min(86vh,820px)]"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    {/* Phones: one portrait at a time. */}
    <div className="absolute inset-0 md:hidden">
      {images.map((image, position) => <Image key={`${image.src}-${position}`} src={image.src} alt={position === index ? image.alt : ""} fill priority={position === 0}
        sizes="100vw" quality={PHOTO_QUALITY} className={`object-cover object-[center_20%] transition-opacity duration-[1200ms] ease-out ${position === index ? "opacity-100" : "opacity-0"}`} />)}
    </div>

    {/* Wider screens: the spread. With fewer than three photos the first column
        stays a dark panel for the name, so no photo is ever stretched. */}
    <div className={`absolute inset-0 hidden gap-[2px] md:grid ${spread.length >= 3 ? "grid-cols-3" : spread.length === 2 ? "grid-cols-[1.1fr_1fr_1fr]" : "grid-cols-[1.4fr_1fr]"}`}>
      {spread.length < 3 && <div className="bg-[var(--ink)]" />}
      {spread.map((image, position) => <div key={`${image.src}-spread-${position}`} className="relative min-w-0 overflow-hidden">
        <Image src={image.src} alt={image.alt} fill priority quality={PHOTO_QUALITY}
          sizes={spread.length >= 3 ? "34vw" : spread.length === 2 ? "33vw" : "42vw"} className="object-cover object-[center_20%]" />
      </div>)}
    </div>

    <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/45 md:from-black/75 md:via-black/5 md:to-black/30" />
    <div aria-hidden className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/50 to-transparent" />

    <div className="container relative flex h-full flex-col justify-end pb-10 md:pb-16">
      <Link href={backHref} className="label-sm mb-8 hidden w-fit items-center gap-2 text-white/70 hover:text-white md:inline-flex"><ArrowLeft size={13} aria-hidden /> Roster</Link>
      {categories.length > 0 && <p className="label-sm mb-4 text-white/80 md:mb-5">{categories.join("  /  ")}</p>}
      <h1 className="display max-w-[14ch] text-[clamp(52px,9vw,128px)] uppercase leading-[.86] tracking-[-.01em] [text-shadow:0_2px_30px_rgba(0,0,0,.35)]">{name}</h1>
      {location && <p className="label mt-5 text-white/85">{location}</p>}
      {hasVideo && <a href="#video" className="label mt-8 flex w-fit items-center gap-4 text-white hover:opacity-80 md:mt-10">
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/80 md:h-12 md:w-12"><Play size={16} fill="currentColor" aria-hidden className="ml-0.5" /></span>
        Watch video
      </a>}
      <a href="#portfolio" aria-label="Scroll to portfolio" className="absolute bottom-6 right-[max(24px,calc((100%-1280px)/2))] hidden text-white/70 hover:text-white md:block">
        <ChevronDown size={26} strokeWidth={1} aria-hidden />
      </a>
    </div>

    {count > 1 && <div className="absolute bottom-10 right-6 flex items-center gap-2 text-[11px] font-500 tracking-[.18em] text-white/80 md:hidden">
      <span aria-live="polite">{pad(index + 1)}</span>
      <span className="flex gap-1.5">{images.map((image, position) => <button key={`${image.src}-dot-${position}`} type="button" onClick={() => setIndex(position)} aria-label={`Show photo ${position + 1} of ${count}`}
        className={`h-px w-4 transition-colors ${position === index ? "bg-white" : "bg-white/35 hover:bg-white/70"}`} />)}</span>
      <span>/ {pad(count)}</span>
    </div>}
  </section>;
}
