import Link from "next/link";

export const metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-6 text-[var(--ink)]">
    <div className="max-w-md text-center">
      <Link href="/" className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[var(--ink)] text-[12px] font-800 tracking-[-.08em]" aria-label="42 Model Management — home">42</Link>
      <p className="mt-10 text-[10px] font-800 uppercase tracking-[.2em] text-[var(--muted)]">404</p>
      <h1 className="mt-3 display text-5xl leading-none">Page not found</h1>
      <p className="mt-5 text-sm leading-6 text-[var(--muted)]">The page you are looking for has moved, is no longer public, or never existed.</p>
      <div className="mt-10 flex flex-wrap justify-center gap-6 text-[10px] font-800 uppercase tracking-[.16em]">
        <Link href="/models" className="border-b border-[var(--ink)] pb-1">Browse talent</Link>
        <Link href="/" className="border-b border-transparent pb-1 text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]">Home</Link>
      </div>
    </div>
  </main>;
}
