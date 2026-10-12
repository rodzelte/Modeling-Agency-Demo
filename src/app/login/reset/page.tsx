import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AuthShell } from "../AuthShell";
import { SignOutLink } from "../SignOutLink";
import { ResetForm } from "./ResetForm";

export const metadata = { title: "Choose a new password", robots: { index: false } };

// Reached from the reset email via /auth/callback, which signs the user in first,
// or from the dashboard when a teammate still has the owner's temporary password.
export default async function ResetPasswordPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=link_expired");
  const firstSignIn = user.user_metadata?.must_change_password === true;
  return <AuthShell eyebrow={firstSignIn ? "Welcome" : "Account recovery"} title={firstSignIn ? "Choose your own password." : "Choose a new password."}
    intro={`For ${user.email ?? "your account"}. ${firstSignIn ? "Replace the temporary password you were given. " : ""}Use at least 10 characters; a passphrase is easiest to remember.`}>
    <ResetForm firstSignIn={firstSignIn} />
    <SignOutLink />
  </AuthShell>;
}
