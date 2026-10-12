"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BriefcaseBusiness, CalendarCheck, CalendarDays, ContactRound, Globe2, Grid2X2, Inbox, LayoutDashboard, ListTodo, LogOut, Menu, MessageSquareDiff,
  Import, Package, RefreshCcwDot, Search, Settings2, UsersRound, Wallet, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { NavIcon, NavSection } from "./nav";

const icons: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard, talent: UsersRound, applications: Inbox, bookings: CalendarCheck, requests: MessageSquareDiff, boards: Grid2X2, search: Search, calendar: CalendarDays, tasks: ListTodo,
  companies: BriefcaseBusiness, contacts: ContactRound, packages: Package, finance: Wallet, website: Globe2, settings: Settings2, ghl: RefreshCcwDot, import: Import,
};

type Viewer = { name: string; email: string; role: string; avatarUrl: string | null };

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardFrame({ nav, viewer, children }: { nav: NavSection[]; viewer: Viewer; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Escape closes the mobile menu, like a dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return <div className="min-h-screen bg-[#f7f7f5] text-[#20211f]">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-xs">Skip to content</a>
    {open && <button type="button" aria-label="Close menu" className="fixed inset-0 z-30 bg-[#20211f]/40 lg:hidden" onClick={() => setOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto bg-[#20211f] px-4 py-6 text-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between px-2">
        <Link href="/dashboard" className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/40 text-[11px] font-800 tracking-[-.08em]">42</span><span className="text-[10px] font-800 uppercase tracking-[.16em]">Model Management</span></Link>
        <button type="button" className="lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X size={18} /></button>
      </div>
      <nav aria-label="Dashboard" className="mt-8 flex-1 space-y-7">
        {nav.map((section) => <div key={section.title}>
          <p className="px-3 text-[9px] font-800 uppercase tracking-[.2em] text-white/55">{section.title}</p>
          <ul className="mt-2 space-y-0.5">{section.items.map((item) => {
            const Icon = icons[item.icon];
            const active = isActive(pathname, item.href);
            return <li key={item.href}><Link href={item.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[12px] font-600 transition-colors ${active ? "bg-white text-[#20211f]" : "text-white/65 hover:bg-white/10 hover:text-white"}`}>
              <Icon size={16} strokeWidth={1.8} /><span className="flex-1">{item.label}</span>
              {item.phase && <span className={`text-[8px] font-800 uppercase tracking-[.1em] ${active ? "text-[#6b6d66]" : "text-white/55"}`}>Soon</span>}
            </Link></li>;
          })}</ul>
        </div>)}
      </nav>
      <div className="mt-6 border-t border-white/10 pt-4">
        <Link href="/dashboard/profile" onClick={() => setOpen(false)} aria-current={pathname === "/dashboard/profile" ? "page" : undefined} title="My profile"
          className={`flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/10 ${pathname === "/dashboard/profile" ? "bg-white/10" : ""}`}>
          {viewer.avatarUrl
            ? <span className="h-8 w-8 shrink-0 rounded-full bg-cover bg-center" style={{ backgroundImage: `url(${viewer.avatarUrl})` }} aria-hidden />
            : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-800">{viewer.name.slice(0, 1).toUpperCase()}</span>}
          <div className="min-w-0"><p className="truncate text-xs font-700">{viewer.name}</p><p className="truncate text-[10px] uppercase tracking-[.1em] text-white/60">{viewer.role.replace("_", " ")} · My profile</p></div>
        </Link>
        <button type="button" onClick={signOut} className="mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[12px] text-white/60 hover:bg-white/10 hover:text-white"><LogOut size={16} />Sign out</button>
      </div>
    </aside>

    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-[#e7e7e3] bg-[#f7f7f5]/95 px-4 backdrop-blur sm:px-8">
        <button type="button" className="lg:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={20} /></button>
        <form action="/dashboard/search" role="search" className="flex max-w-md flex-1 items-center gap-2 rounded-md border border-[#e7e7e3] bg-white px-3 py-2">
          <Search size={15} className="text-[#6b6d66]" aria-hidden />
          <label htmlFor="global-search" className="sr-only">Search the workspace</label>
          <input id="global-search" name="q" placeholder="Search talent and boards" className="w-full bg-transparent text-sm outline-none placeholder:text-[#717369]" />
        </form>
        <Link href="/" className="ml-auto hidden text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66] hover:text-[#20211f] sm:block">View website ↗</Link>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-8">{children}</main>
    </div>
  </div>;
}
