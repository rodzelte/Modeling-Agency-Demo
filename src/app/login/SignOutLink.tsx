"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// For pages reached half signed in (two-step code, first-time password): going
// back to the sign-in page needs a sign-out, or the dashboard sends them here again.
export function SignOutLink({ label = "← Back to sign in" }: { label?: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await createClient().auth.signOut();
    window.location.replace("/login");
  }

  return <button type="button" onClick={signOut} disabled={busy}
    className="mt-6 block w-full text-center text-[10px] font-800 uppercase tracking-[.14em] text-[#a4502f] hover:text-[#20211f] disabled:opacity-50">
    {busy ? "Signing out…" : label}
  </button>;
}
