"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/demo/accounts";

// Demo mode only: one-click entry as each sample person, shown on the sign-in
// pages in place of real credentials.
export function DemoAccounts({ area }: { area?: "dashboard" | "portal" }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const accounts = area ? [...DEMO_ACCOUNTS].sort((a, b) => Number(b.area === area) - Number(a.area === area)) : DEMO_ACCOUNTS;

  async function enter(key: string) {
    setPending(key); setError("");
    try {
      const response = await fetch("/api/demo/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: key }) });
      const result = await response.json().catch(() => null) as { redirect?: string; error?: string } | null;
      if (!response.ok || !result?.redirect) throw new Error(result?.error ?? "Sign-in failed. Try again.");
      window.location.assign(result.redirect);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign-in failed. Try again.");
      setPending(null);
    }
  }

  return <section aria-labelledby="demo-accounts" className="mt-8 rounded-xl border border-[#e7e3dc] bg-[#faf8f4] p-4">
    <p id="demo-accounts" className="flex items-center gap-2 text-[10px] font-800 uppercase tracking-[.18em] text-[#a4502f]"><span className="h-1.5 w-1.5 rounded-full bg-[#d5a561]" aria-hidden />Demo accounts</p>
    <p className="mt-2 text-xs leading-5 text-[#6b6d66]">Choose who to explore as. Each role sees a different part of the system. No password needed.</p>
    <ul className="mt-3 space-y-1.5">
      {accounts.map((account) => <li key={account.key}>
        <button type="button" disabled={pending !== null} onClick={() => enter(account.key)}
          className="group flex w-full items-center gap-3 rounded-lg border border-[#e7e3dc] bg-white px-3 py-2.5 text-left transition-colors hover:border-[#a4502f] disabled:opacity-60">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#20211f] text-[11px] font-800 text-white" aria-hidden>{account.name.slice(0, 1)}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-700 text-[#20211f]">{account.label} <span className="font-500 text-[#6b6d66]">· {account.name}</span></span>
            <span className="block truncate text-[11px] text-[#6b6d66]">{account.blurb}</span>
          </span>
          <span className="text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66] group-hover:text-[#a4502f]">{pending === account.key ? "Opening…" : <ArrowRight size={14} aria-label="Enter" />}</span>
        </button>
      </li>)}
    </ul>
    {error && <p role="alert" className="mt-3 rounded-md bg-[#f8e8df] px-3 py-2 text-xs text-[#a9593d]">{error}</p>}
    <p className="mt-3 text-[11px] leading-5 text-[#6b6d66]">The form below also works: use any sample address (for example <span className="font-600 text-[#20211f]">{DEMO_ACCOUNTS[0].email}</span>) with the password <span className="font-600 text-[#20211f]">{DEMO_PASSWORD}</span>. Emails and Google sign-in are simulated in the demo.</p>
  </section>;
}
