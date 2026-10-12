"use client";

import { useState } from "react";
import { authButton, authError, authInput, authLabel, authNotice } from "@/app/login/AuthShell";
import { createClient } from "@/lib/supabase/client";

export function PortalLoginForm({ initialError }: { initialError: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState(initialError);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending"); setError("");
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/portal")}`;
    const { error: otpError } = await createClient().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo, shouldCreateUser: true } });
    if (otpError && otpError.status === 429) { setState("idle"); setError("Too many requests. Wait a minute, then try again."); return; }
    // Same message either way, so the form never reveals who is registered.
    setState("sent");
  }

  if (state === "sent") return <p className={`mt-8 ${authNotice}`} role="status">{process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? "Demo mode sends no email. Use the “Talent (portal)” demo account above to open the portal." : "Check your inbox for a sign-in link from 42 Model Management. It works once and expires after an hour."}</p>;

  return <form onSubmit={submit} className="mt-8 space-y-4">
    <label className={authLabel}>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={authInput} placeholder="you@example.com" /></label>
    {error && <p className={authError} role="alert">{error}</p>}
    <button disabled={state === "sending"} className={authButton}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
  </form>;
}
