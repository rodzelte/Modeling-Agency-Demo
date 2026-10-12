import Link from "next/link";
import { getNavigation, getSiteSettings } from "@/features/cms/queries";

// Footer links come from Dashboard → Website → Navigation. Links to CMS pages
// that are not published are hidden automatically.
export async function SiteFooter({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const [{ footer }, settings] = await Promise.all([getNavigation(), getSiteSettings()]);
  const dark = tone === "dark";
  const linkClass = dark ? "hover:text-white" : "hover:text-[var(--ink)]";
  return <footer className={dark ? "border-t border-white/10 bg-[var(--ink)] text-white/60" : "border-t border-[var(--line)] bg-[var(--paper)] text-[var(--muted)]"}>
    <div className="container grid gap-10 py-12 sm:py-16 md:grid-cols-[1fr_auto] md:items-end">
      <Link href="/" className={`flex w-fit flex-col leading-none ${dark ? "text-white" : "text-[var(--ink)]"}`} aria-label="42 Model Management, home">
        <span className="display text-[56px] leading-[.85]">42</span>
        <span className="mt-2 text-[9px] font-500 uppercase tracking-[.32em]">Model Management</span>
      </Link>
      <nav aria-label="Footer" className="label-sm flex flex-wrap gap-x-7 gap-y-3">
        <Link href="/models" className={linkClass}>Models</Link>
        <Link href="/join" prefetch={false} className={linkClass}>Join us</Link>
        {footer.filter((item) => item.href !== "/models" && item.href !== "/join").map((item) => item.href.startsWith("/")
          ? <Link key={item.id} href={item.href} prefetch={item.href === "/join" ? false : undefined} className={linkClass}>{item.label}</Link>
          : <a key={item.id} href={item.href} target={item.href.startsWith("https://") ? "_blank" : undefined} rel="noopener noreferrer" className={linkClass}>{item.label}</a>)}
        {settings.instagram_url && <a href={settings.instagram_url} target="_blank" rel="noopener noreferrer" className={linkClass}>Instagram ↗</a>}
      </nav>
    </div>
    <div className={`container flex flex-col justify-between gap-2 border-t py-5 text-[10px] tracking-[.14em] sm:flex-row ${dark ? "border-white/10" : "border-[var(--line)]"}`}>
      <span>© {new Date().getFullYear()} 42 Model Management</span>
      <a href={`mailto:${settings.contact_email}`} className={linkClass}>{settings.contact_email}</a>
    </div>
  </footer>;
}
