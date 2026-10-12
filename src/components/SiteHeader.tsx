import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import { getPublicBoards } from "@/features/public/queries";
import { getNavigation, getSiteSettings } from "@/features/cms/queries";
import { SiteMenu, type MenuLink } from "./SiteMenu";

// Menu: all talent, then every public board as in Dashboard → Boards (top-level
// boards marked "show in navigation", each with its public sub-boards), header
// links from Dashboard → Website → Navigation, then About / Join us / Contact.
// Desktop shows sub-boards in a dropdown; the full-screen menu lists everything.
export async function SiteHeader({ dark = false }: { dark?: boolean }) {
  const [boards, navigation, settings] = await Promise.all([getPublicBoards(), getNavigation(), getSiteSettings()]);
  const short = (name: string) => name.split(" / ").pop() as string;
  const topBoards = boards.filter((board) => board.depth === 0 && board.show_in_navigation);
  const links: MenuLink[] = [
    { href: "/models", label: "Models" },
    ...topBoards.map((board) => ({
      href: `/models/${board.path}`,
      label: board.name,
      children: boards.filter((child) => child.parent_id === board.id && child.show_in_navigation).map((child) => ({ href: `/models/${child.path}`, label: short(child.name) })),
    })),
    ...navigation.header.map((item) => ({ href: item.href, label: item.label })),
    { href: navigation.liveSlugs.has("about") ? "/about" : "/#about", label: "About" },
    { href: "/join", label: "Join us" },
    { href: "/#contact", label: "Contact" },
  ].filter((link, index, all) => all.findIndex((other) => other.href === link.href) === index);
  const inline = links.filter((link) => link.href !== "/join").slice(0, 7);
  const anchor = (link: MenuLink, className: string) => link.href.startsWith("https://")
    ? <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className={className}>{link.label}</a>
    : <Link key={link.href} href={link.href} className={className}>{link.label}</Link>;

  return (
    <header className={`absolute inset-x-0 top-0 z-30 ${dark ? "text-white" : "text-[var(--ink)]"}`}>
      <div className="container grid h-[88px] grid-cols-[1fr_auto] items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <Link href="/" className="flex w-fit flex-col items-start leading-none" aria-label="42 Model Management, home">
          <span className="display text-[34px] leading-[.85] tracking-[-.02em] sm:text-[40px]">42</span>
          <span className="mt-1.5 text-[8px] font-500 uppercase tracking-[.32em] sm:text-[9px]">Model Management</span>
        </Link>
        <nav aria-label="Main" className="label hidden items-center gap-8 lg:flex">
          {inline.map((link) => link.children?.length
            ? <div key={link.href} className="group relative">
                <span className="flex items-center gap-1.5">
                  {anchor(link, "transition-opacity hover:opacity-60")}
                  <ChevronDown size={12} strokeWidth={1.5} aria-hidden className="opacity-60 transition-transform group-hover:rotate-180 group-focus-within:rotate-180" />
                </span>
                {/* Sub-boards: shown on hover or keyboard focus. */}
                <div className="invisible absolute left-1/2 top-full z-40 -translate-x-1/2 pt-4 opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                  <ul className="min-w-48 border border-[var(--line)] bg-[var(--paper)] py-2 text-[var(--ink)] shadow-[0_18px_40px_-20px_rgba(0,0,0,.35)]">
                    <li>{anchor({ href: link.href, label: `All ${link.label}` }, "block px-5 py-2.5 hover:bg-[var(--cream)]")}</li>
                    {link.children.map((child) => <li key={child.href}>{anchor(child, "block px-5 py-2.5 text-[var(--muted)] hover:bg-[var(--cream)] hover:text-[var(--ink)]")}</li>)}
                  </ul>
                </div>
              </div>
            : anchor(link, "transition-opacity hover:opacity-60"))}
        </nav>
        <div className="flex items-center justify-end gap-1">
          <Link href="/models#search" aria-label="Search talent" className="flex h-10 w-10 items-center justify-center transition-opacity hover:opacity-60"><Search size={20} strokeWidth={1.25} aria-hidden /></Link>
          <SiteMenu links={links} email={settings.contact_email} />
        </div>
      </div>
    </header>
  );
}
