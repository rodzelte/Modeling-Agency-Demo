"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const LINKS = [
  { href: "/portal", label: "Home" },
  { href: "/portal/profile", label: "Profile" },
  { href: "/portal/bookings", label: "Bookings" },
  { href: "/portal/availability", label: "Availability" },
  { href: "/portal/digitals", label: "Digitals" },
  { href: "/portal/documents", label: "Documents" },
  { href: "/portal/subscribe", label: "Membership" },
];

export function PortalNav() {
  const pathname = usePathname();
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.push("/portal/login");
    router.refresh();
  }
  return <nav aria-label="Portal" className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden">
    {LINKS.map((link) => {
      const active = link.href === "/portal" ? pathname === "/portal" : pathname.startsWith(link.href);
      return <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}
        className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-800 uppercase tracking-[.12em] ${active ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{link.label}</Link>;
    })}
    <button type="button" onClick={signOut} className="ml-auto flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-[10px] font-800 uppercase tracking-[.12em] text-[var(--muted)] hover:text-[var(--ink)]"><LogOut size={13} aria-hidden />Sign out</button>
  </nav>;
}
