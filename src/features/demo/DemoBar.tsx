"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, RotateCcw, Users } from "lucide-react";

// The "Demo Mode" marker shown on every page of a demo build, with the reset
// control. Rendered by the root layout only when demo mode is on.
export function DemoBar() {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reset() {
    if (!window.confirm("Reset the demo?\n\nEverything added, edited or deleted during this demo is discarded and the original sample data comes back.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/demo/reset", { method: "POST", headers: { "x-demo-reset": "1" } });
      if (!response.ok) throw new Error("reset failed");
      // Reload from a page that certainly still exists.
      const path = window.location.pathname;
      window.location.assign(path.startsWith("/dashboard") ? "/dashboard" : path.startsWith("/portal") ? "/portal" : path.startsWith("/login") ? "/login" : "/");
    } catch {
      setError("The reset did not finish. Try again.");
      setBusy(false);
    }
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} aria-label="Show demo mode controls"
      className="fixed bottom-3 left-1/2 z-[58] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-[#20211f] px-3 py-1.5 font-sans text-[9px] font-800 uppercase tracking-[.18em] text-white shadow-lg print:hidden">
      <span className="h-1.5 w-1.5 rounded-full bg-[#d5a561]" aria-hidden />Demo mode
    </button>;
  }

  return <aside aria-label="Demo mode" className="fixed bottom-3 left-1/2 z-[58] flex w-max max-w-[calc(100%_-_24px)] -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-[#20211f] py-1.5 pl-4 pr-1.5 font-sans text-white shadow-xl print:hidden">
    <span className="flex items-center gap-2 text-[9px] font-800 uppercase tracking-[.18em]"><span className="h-1.5 w-1.5 rounded-full bg-[#d5a561]" aria-hidden />Demo mode</span>
    <span className="hidden text-[11px] text-white/65 md:inline" role={error ? "alert" : undefined}>{error || "Sample data only. Nothing here is real, and nothing you do is saved to a live system."}</span>
    <span className="flex items-center gap-1">
      <button type="button" onClick={reset} disabled={busy}
        className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[9px] font-800 uppercase tracking-[.14em] text-[#20211f] transition-colors hover:bg-[#d5a561] disabled:opacity-60">
        <RotateCcw size={11} aria-hidden />{busy ? "Resetting…" : "Reset demo data"}
      </button>
      <Link href="/login" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] font-800 uppercase tracking-[.14em] text-white/75 transition-colors hover:bg-white/10 hover:text-white">
        <Users size={11} aria-hidden /><span className="hidden sm:inline">Switch account</span><span className="sm:hidden">Accounts</span>
      </Link>
      <button type="button" onClick={() => setOpen(false)} aria-label="Minimise demo mode controls" className="rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"><ChevronDown size={13} /></button>
    </span>
  </aside>;
}
