import Link from "next/link";
import type { ReactNode } from "react";

// Shared frame for the sign-in, forgot-password and reset-password pages.
export function AuthShell({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-[#f5f3ef] p-6"><div className="w-full max-w-md rounded-2xl border border-[#e7e3dc] bg-white p-8 shadow-sm sm:p-10">
    <Link href="/" className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#20211f] text-[11px] font-800 tracking-[-.08em]">42</span><span className="text-[10px] font-800 uppercase tracking-[.16em]">Model Management</span></Link>
    <p className="mt-14 text-[10px] font-800 uppercase tracking-[.2em] text-[#a4502f]">{eyebrow}</p>
    <h1 className="mt-3 text-3xl font-700 tracking-[-.04em]">{title}</h1>
    <p className="mt-3 text-sm leading-6 text-[#6b6d66]">{intro}</p>
    {children}
    <Link href="/" className="mt-6 block text-center text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66]">← Back to public site</Link>
  </div></main>;
}

export const authInput = "mt-2 w-full rounded-md border border-[#e7e7e3] px-3 py-3 text-sm normal-case tracking-normal outline-none focus:border-[#a4502f]";
export const authLabel = "block text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66]";
export const authButton = "w-full rounded-md bg-[#20211f] px-4 py-3 text-[11px] font-800 uppercase tracking-[.14em] text-white transition-colors hover:bg-[#a4502f] disabled:opacity-50";
export const authError = "rounded-md bg-[#f8e8df] px-3 py-2 text-xs text-[#a9593d]";
export const authNotice = "rounded-md bg-[#eef3ec] px-3 py-2 text-xs text-[#3f6b45]";
