"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authButton, authError, authInput, authLabel } from "../AuthShell";

// firstSignIn: a teammate replacing the owner's temporary password; they stay
// signed in. Otherwise (reset link) every session is signed out.
export function ResetForm({ firstSignIn = false }: { firstSignIn?: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setSaving(true); setError("");
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    if (updateError) {
      setSaving(false);
      setError(updateError.code === "weak_password" || updateError.code === "same_password" ? updateError.message : "The password could not be updated. Request a new reset link and try again.");
      return;
    }
    if (firstSignIn) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    // Sign out everywhere so the new password is required on every device.
    await supabase.auth.signOut({ scope: "global" });
    router.push("/login?reset=done");
    router.refresh();
  }

  return <form onSubmit={submit} className="mt-8 space-y-4">
    <label className={authLabel}>New password<input required type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} className={authInput} /></label>
    <label className={authLabel}>Confirm new password<input required type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={(event) => setConfirm(event.target.value)} className={authInput} /></label>
    {error && <p className={authError} role="alert">{error}</p>}
    <button disabled={saving} className={authButton}>{saving ? "Saving…" : "Save new password"}</button>
  </form>;
}
