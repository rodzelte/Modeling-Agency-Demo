import { redirect } from "next/navigation";
import { safePath } from "@/lib/safe-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AuthShell } from "../AuthShell";
import { SignOutLink } from "../SignOutLink";
import { MfaForm } from "./MfaForm";

export const metadata = { title: "Two-step sign-in", robots: { index: false } };

// Owner and administrator accounts reach this page when the session has no second
// step yet (src/lib/agency-auth.ts): an emailed code (default, migration 028), an
// authenticator app code, or a Google sign-in from the last 30 days.
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const next = safePath((await searchParams).next, "/dashboard");
  const google = ((user.app_metadata?.providers as string[] | undefined) ?? [user.app_metadata?.provider]).includes("google");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasApp = Boolean(factors?.totp.some((factor) => factor.status === "verified"));
  const intro = "Your role can see sensitive talent data, so we confirm it’s you with a second step: a code sent to your work email.";
  return <AuthShell eyebrow="Security" title="Confirm it's you." intro={intro}>
    <MfaForm next={next} email={user.email ?? ""} google={google} hasApp={hasApp} />
    <SignOutLink label="← Back to sign in (use another account)" />
  </AuthShell>;
}
