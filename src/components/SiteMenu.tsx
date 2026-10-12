"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

export type MenuLink = { href: string; label: string; children?: MenuLink[] };

// Full-screen menu (all screen sizes). Closes on Escape or when a link is chosen, and
// returns focus to the button; the page behind does not scroll while it is open.
export function SiteMenu({ links, email }: { links: MenuLink[]; email: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = button.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); trigger?.focus(); };
  }, [open]);

  const external = (href: string) => href.startsWith("https://");
  return <>
    <button ref={button} type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="site-menu" aria-label="Open menu"
      className="flex h-10 w-10 items-center justify-center transition-opacity hover:opacity-60">
      <Menu size={22} strokeWidth={1.25} aria-hidden />
    </button>
    {open && <div id="site-menu" role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-0 z-50 flex flex-col bg-[var(--ink)] text-white">
      <div className="container flex h-[88px] items-center justify-between">
        <span className="display text-[34px] leading-none">42</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="flex h-10 w-10 items-center justify-center hover:opacity-60"><X size={24} strokeWidth={1.25} aria-hidden /></button>
      </div>
      <nav aria-label="Menu" className="container flex flex-1 flex-col justify-center gap-1 overflow-y-auto py-8">
        {links.map((link, index) => {
          const className = "display w-fit text-[clamp(36px,7vw,72px)] uppercase leading-[1.08] tracking-[.02em] text-white/85 transition-colors hover:text-white";
          const main = external(link.href)
            ? <a ref={index === 0 ? first : undefined} href={link.href} target="_blank" rel="noopener noreferrer" className={className}>{link.label}</a>
            : <Link ref={index === 0 ? first : undefined} href={link.href} prefetch={link.href === "/join" ? false : undefined} className={className} onClick={() => setOpen(false)}>{link.label}</Link>;
          return <div key={link.href}>
            {main}
            {link.children?.length ? <ul className="mb-3 mt-1 flex flex-wrap gap-x-6 gap-y-2 pl-1">
              {link.children.map((child) => <li key={child.href}><Link href={child.href} onClick={() => setOpen(false)} className="label-sm text-white/55 hover:text-white">{child.label}</Link></li>)}
            </ul> : null}
          </div>;
        })}
      </nav>
      <div className="container flex flex-col gap-4 border-t border-white/15 py-6 sm:flex-row sm:items-center sm:justify-between">
        <a href={`mailto:${email}`} className="label-sm text-white/70 hover:text-white">{email}</a>
        <Link href="/dashboard" className="label-sm text-white/50 hover:text-white" onClick={() => setOpen(false)}>Staff login</Link>
      </div>
    </div>}
  </>;
}
