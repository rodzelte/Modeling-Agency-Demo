"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authButton, authError, authInput, authLabel, authNotice } from "../AuthShell";

type Setup = { factorId: string; qr: string; secret: string };
type Mode = "email" | "verify" | "loading" | "enroll" | "error";

// Second sign-in step. Default: a 6-digit code emailed to the work address
// (/api/auth/email-code, migration 028). People who set up an authenticator app
// use it by default; Google accounts can also continue with Google.
export function MfaForm({ next, email, google, hasApp }: { next: string; email: string; google: boolean; hasApp: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(hasApp ? "verify" : "email");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Authenticator app: find the verified factor, or start setting one up.
  useEffect(() => {
    if (mode !== "loading" && mode !== "verify") return;
    if (mode === "verify" && factorId) return;
    let cancelled = false;
    (async () => {
      const client = createClient();
      const { data, error: listError } = await client.auth.mfa.listFactors();
      if (cancelled) return;
      if (listError) { setMode("error"); setError("Two-step sign-in is not available right now. Try again, or contact the owner."); return; }
      const verified = data.totp.find((factor) => factor.status === "verified");
      if (verified) { setFactorId(verified.id); setMode("verify"); return; }
      // Clear half-finished setups, then start a new one.
      for (const factor of data.all.filter((item) => item.status === "unverified")) await client.auth.mfa.unenroll({ factorId: factor.id });
      const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `42 dashboard ${new Date().toISOString().slice(0, 10)}` });
      if (cancelled) return;
      if (enrollError || !enrolled) { setMode("error"); setError("The authenticator app could not be set up. Use the emailed code instead."); return; }
      setSetup({ factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
      setFactorId(enrolled.id);
      setMode("enroll");
    })();
    return () => { cancelled = true; };
  }, [mode, factorId]);

  function switchTo(target: Mode) {
    setError(""); setCode("");
    setMode(target);
  }

  // A fresh Google sign-in counts as the second step (src/lib/mfa-policy.ts).
  async function continueWithGoogle() {
    setBusy(true); setError("");
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error: oauthError } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (oauthError) { setError("Google sign-in did not start. Try again."); setBusy(false); }
  }

  async function post(url: string, body?: unknown) {
    const response = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, payload: payload as { error?: string; sentTo?: string } };
  }

  async function sendCode() {
    setBusy(true); setError("");
    const { ok, payload } = await post("/api/auth/email-code");
    setBusy(false);
    if (!ok) { setError(payload.error ?? "The code could not be sent. Try again."); return; }
    setSentTo(payload.sentTo ?? email);
    setCode("");
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    if (mode === "email") {
      const { ok, payload } = await post("/api/auth/email-code/verify", { code });
      if (!ok) { setBusy(false); setError(payload.error ?? "That code didn’t work."); return; }
    } else {
      if (!factorId) { setBusy(false); return; }
      const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
      if (verifyError) { setBusy(false); setError("That code did not work. Check the time on your phone and try the newest code."); return; }
    }
    router.push(next);
    router.refresh();
  }

  const linkClass = "w-full text-center text-xs font-700 text-[#6b6d66] underline underline-offset-4 hover:text-[#20211f]";
  const codeInput = <label className={authLabel}>6-digit code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,11}" maxLength={11} value={code} onChange={(event) => setCode(event.target.value)} className={`${authInput} text-center font-mono text-lg tracking-[.4em]`} placeholder="000000" autoFocus /></label>;
  const googleButton = google && <button type="button" onClick={continueWithGoogle} disabled={busy} className="flex w-full items-center justify-center gap-3 rounded-md border border-[#d9d5ce] bg-white px-4 py-3 text-[11px] font-800 uppercase tracking-[.14em] text-[#20211f] transition-colors hover:border-[#a4502f] disabled:opacity-50">
    <span className="text-base font-700 normal-case">G</span>Continue with Google
  </button>;

  if (mode === "loading") return <p className="mt-8 text-sm text-[#6b6d66]">Loading…</p>;
  if (mode === "error") return <div className="mt-8 space-y-4">
    <p className={authError} role="alert">{error}</p>
    <button type="button" onClick={() => switchTo("email")} className={linkClass}>Email me a code instead</button>
  </div>;

  if (mode === "email") return <div className="mt-8 space-y-4">
    {googleButton}
    {!sentTo
      ? <>
          <p className="text-sm text-[#3d3f3a]">We’ll email a 6-digit code to <strong className="break-all">{email}</strong>.</p>
          {error && <p className={authError} role="alert">{error}</p>}
          <button type="button" onClick={sendCode} disabled={busy} className={authButton}>{busy ? "Sending…" : "Email me a code"}</button>
        </>
      : <form onSubmit={verify} className="space-y-4">
          <p className={authNotice} role="status">Code sent to {sentTo}. It can take a minute; check spam too.</p>
          {codeInput}
          {error && <p className={authError} role="alert">{error}</p>}
          <button disabled={busy} className={authButton}>{busy ? "Checking…" : "Continue"}</button>
          <button type="button" onClick={sendCode} disabled={busy} className={linkClass}>Send a new code</button>
        </form>}
    <p className="text-center text-[11px] text-[#6b6d66]">You won’t be asked again on this device for 30 days.</p>
    <button type="button" onClick={() => switchTo(hasApp ? "verify" : "loading")} className={linkClass}>Use an authenticator app instead</button>
  </div>;

  return <form onSubmit={verify} className="mt-8 space-y-4">
    {googleButton}
    {mode === "enroll" && setup && <div className="space-y-3 rounded-lg border border-[#e7e3dc] p-4 text-sm">
      <p><strong>1.</strong> Scan this code with your authenticator app{email ? ` (account: ${email})` : ""}.</p>
      {/* Supabase returns the QR code as an SVG data URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="QR code for your authenticator app" className="mx-auto h-44 w-44" />
      <p className="text-xs text-[#6b6d66]">Can’t scan? Enter this key: <code className="break-all font-mono text-[#20211f]">{setup.secret}</code></p>
      <p><strong>2.</strong> Enter the 6-digit code it shows.</p>
    </div>}
    {codeInput}
    {error && <p className={authError} role="alert">{error}</p>}
    <button disabled={busy} className={authButton}>{busy ? "Checking…" : mode === "enroll" ? "Turn on two-step sign-in" : "Continue"}</button>
    <button type="button" onClick={() => switchTo("email")} className={linkClass}>Email me a code instead</button>
  </form>;
}
