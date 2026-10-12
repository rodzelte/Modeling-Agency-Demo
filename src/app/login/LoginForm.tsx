"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { authButton, authError, authInput, authLabel, authNotice } from "./AuthShell";

export function LoginForm({ nextPath, initialError = "", initialNotice = "" }: { nextPath: string; initialError?: string; initialNotice?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError("");
    const { error: signInError } = await createClient().auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    window.location.assign(nextPath || "/dashboard");
  }

  async function signInWithGoogle() {
    setLoading(true); setError("");
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath || "/dashboard")}`;
    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
  }

  return <div className="mt-8">
    <button type="button" onClick={signInWithGoogle} disabled={loading} className="flex w-full items-center justify-center gap-3 rounded-md border border-[#d9d5ce] bg-white px-4 py-3 text-[11px] font-800 uppercase tracking-[.14em] text-[#20211f] transition-colors hover:border-[#a4502f] disabled:opacity-50">
      <span className="text-base font-700 normal-case">G</span>
      {loading ? "Connecting…" : "Continue with Google"}
    </button>
    <div className="my-6 flex items-center gap-3 text-[9px] font-800 uppercase tracking-[.18em] text-[#6b6d66]"><span className="h-px flex-1 bg-[#e7e3dc]" />or<span className="h-px flex-1 bg-[#e7e3dc]" /></div>
    <form onSubmit={submit} className="space-y-4">
      {initialNotice && !error && <p className={authNotice}>{initialNotice}</p>}
      <label className={authLabel}>Work email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={authInput} placeholder="you@agency.com" /></label>
      <label className={authLabel}>Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={authInput} placeholder="••••••••" /></label>
      {error && <p className={authError} role="alert">{error}</p>}
      <button disabled={loading} className={authButton}>{loading ? "Signing in…" : "Sign in with email"}</button>
      <Link href="/login/forgot" className="block text-center text-[11px] text-[#6b6d66] underline-offset-4 hover:text-[#20211f] hover:underline">Forgot your password?</Link>
    </form>
  </div>;
}
