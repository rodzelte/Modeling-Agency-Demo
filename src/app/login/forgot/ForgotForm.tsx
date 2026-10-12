"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { authButton, authError, authInput, authLabel, authNotice } from "../AuthShell";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/login/reset")}`;
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo });
    // The same message is shown whether or not the email has an account.
    setState(error && error.status !== 400 && error.status !== 404 ? "error" : "sent");
  }

  if (state === "sent") {
    return <div className="mt-8 space-y-4">
      <p className={authNotice} role="status">{process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? "Demo mode sends no email. Go back to the sign-in page and choose a demo account." : "If an account exists for that email, a reset link is on its way. It expires after one hour."}</p>
      <Link href="/login" className="block text-center text-[11px] text-[#6b6d66] underline-offset-4 hover:text-[#20211f] hover:underline">Back to sign in</Link>
    </div>;
  }

  return <form onSubmit={submit} className="mt-8 space-y-4">
    <label className={authLabel}>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={authInput} placeholder="you@agency.com" /></label>
    {state === "error" && <p className={authError} role="alert">We could not send the email right now. Please try again in a few minutes.</p>}
    <button disabled={state === "sending"} className={authButton}>{state === "sending" ? "Sending…" : "Email me a reset link"}</button>
    <Link href="/login" className="block text-center text-[11px] text-[#6b6d66] underline-offset-4 hover:text-[#20211f] hover:underline">Back to sign in</Link>
  </form>;
}
