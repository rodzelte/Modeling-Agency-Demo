"use client";

import Link from "next/link";

// Public-site error boundary. The server already logged the error (instrumentation);
// only the digest is shown so staff can match it to the logs.
export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-6 text-[var(--ink)]">
    <div className="max-w-md text-center">
      <p className="text-[10px] font-800 uppercase tracking-[.2em] text-[var(--muted)]">Something went wrong</p>
      <h1 className="mt-3 display text-5xl leading-none">We couldn&apos;t load this page</h1>
      <p className="mt-5 text-sm leading-6 text-[var(--muted)]">Please try again in a moment.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
      <div className="mt-10 flex flex-wrap justify-center gap-6 text-[10px] font-800 uppercase tracking-[.16em]">
        <button type="button" onClick={reset} className="border-b border-[var(--ink)] pb-1 uppercase">Try again</button>
        <Link href="/" className="border-b border-transparent pb-1 text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]">Home</Link>
      </div>
    </div>
  </main>;
}
