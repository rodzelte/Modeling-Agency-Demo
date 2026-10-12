"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import { PHOTO_QUALITY, type ProfileImage } from "../types";

type Photo = ProfileImage & { caption?: string | null };

// Photos as a grid on larger screens and a swipeable row on phones; any photo
// opens a full-screen viewer (arrow keys / swipe buttons, Escape to close).
export function PhotoGallery({ id, photos, variant = "portfolio", label }: { id: string; photos: Photo[]; variant?: "portfolio" | "digitals"; label: string }) {
  const [open, setOpen] = useState<number | null>(null);
  // "View all" in the section header (ViewAllButton) opens this gallery's viewer.
  useEffect(() => {
    const onOpen = (event: Event) => { if ((event as CustomEvent<string>).detail === id) setOpen(0); };
    window.addEventListener("gallery:open", onOpen);
    return () => window.removeEventListener("gallery:open", onOpen);
  }, [id]);
  const digitals = variant === "digitals";
  const grid = digitals
    ? "sm:grid sm:grid-cols-3 lg:grid-cols-6 sm:gap-3 lg:gap-4"
    : "sm:grid sm:grid-cols-3 lg:grid-cols-4 sm:gap-3 lg:gap-4";

  return <>
    <ul className={`no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0 ${grid}`} aria-label={label}>
      {photos.map((photo, index) => <li key={`${photo.src}-${index}`} className={`shrink-0 snap-start ${digitals ? "w-[42%]" : "w-[62%]"} sm:w-auto`}>
        <button type="button" onClick={() => setOpen(index)} className="group block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)]" aria-label={`Open photo ${index + 1} of ${photos.length}`}>
          <span className={`image-hover relative block bg-[#e4e1db] ${digitals ? "aspect-[4/5]" : "aspect-[3/4]"}`}>
            <Image src={photo.src} alt={photo.alt} fill quality={PHOTO_QUALITY} sizes={digitals ? "(max-width: 640px) 42vw, (max-width: 1024px) 33vw, 16vw" : "(max-width: 640px) 62vw, (max-width: 1024px) 33vw, 22vw"} className="object-cover" />
          </span>
          {photo.caption && <span className="label-sm mt-3 block text-center !text-[9px] text-[var(--muted)]">{photo.caption}</span>}
        </button>
      </li>)}
    </ul>
    {open !== null && <Lightbox photos={photos} start={open} onClose={() => setOpen(null)} />}
  </>;
}

export function ViewAllButton({ gallery, label = "View all" }: { gallery: string; label?: string }) {
  return <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("gallery:open", { detail: gallery }))}
    className="label-sm flex items-center gap-2 text-[var(--ink)] hover:opacity-60">{label} <ArrowRight size={13} aria-hidden /></button>;
}

function Lightbox({ photos, start, onClose }: { photos: Photo[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const close = useRef<HTMLButtonElement>(null);
  const step = useCallback((by: number) => setIndex((current) => (current + by + photos.length) % photos.length), [photos.length]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; previous?.focus(); };
  }, [onClose, step]);

  const photo = photos[index];
  return <div role="dialog" aria-modal="true" aria-label="Photo viewer" className="fixed inset-0 z-50 flex flex-col bg-[#0b0b0a] text-white">
    <div className="flex items-center justify-between px-4 py-4 sm:px-8">
      <span className="text-[11px] font-500 tracking-[.18em] text-white/70">{String(index + 1).padStart(2, "0")} / {String(photos.length).padStart(2, "0")}</span>
      <button ref={close} type="button" onClick={onClose} aria-label="Close photo viewer" className="flex h-10 w-10 items-center justify-center hover:opacity-70"><X size={24} strokeWidth={1.25} aria-hidden /></button>
    </div>
    <div className="relative flex-1">
      <Image key={photo.src} src={photo.src} alt={photo.alt} fill quality={PHOTO_QUALITY} sizes="100vw" className="object-contain" />
      {photos.length > 1 && <>
        <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 hover:bg-black/60 sm:left-6"><ChevronLeft size={26} strokeWidth={1.25} aria-hidden /></button>
        <button type="button" onClick={() => step(1)} aria-label="Next photo" className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 hover:bg-black/60 sm:right-6"><ChevronRight size={26} strokeWidth={1.25} aria-hidden /></button>
      </>}
    </div>
    <p className="label-sm px-4 py-5 text-center text-white/60">{photo.caption ?? " "}</p>
  </div>;
}
