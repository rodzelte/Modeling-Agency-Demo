import type { Metadata } from "next";
import Link from "next/link";
import { ToastProvider } from "@/components/ui/Toast";
import { requirePortal } from "@/features/portal/context";
import { PortalNav } from "@/features/portal/components/PortalNav";

export const metadata: Metadata = { title: { default: "Talent portal", template: "%s — 42 talent portal" }, robots: { index: false, follow: false } };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requirePortal();
  return <ToastProvider>
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/portal" className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full border border-current text-[10px] font-800 tracking-[-.08em]">42</span><span className="text-[10px] font-800 uppercase tracking-[.16em]">Talent portal</span></Link>
          <span className="truncate text-xs text-[var(--muted)]">{profile.display_name}</span>
        </div>
        <PortalNav />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  </ToastProvider>;
}
