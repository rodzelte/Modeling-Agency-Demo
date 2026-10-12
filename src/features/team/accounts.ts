import "server-only";
import { log } from "@/lib/log";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

// Creates a sign-in account with a temporary password chosen by the owner, through
// the ordinary public sign-up API (no service role): Supabase emails the teammate
// a confirmation link, and confirming binds the account to the approved membership
// (migration 009), so access still comes only from agency_members. The
// must_change_password flag sends them to choose their own password at first
// sign-in. The password is never logged or returned.
export async function createMemberAccount(member: { email: string; fullName: string }, password: string, origin: string)
  : Promise<{ error?: string; confirmationSent?: boolean }> {
  const { data, error } = await createPublicSupabaseClient().auth.signUp({
    email: member.email,
    password,
    options: { emailRedirectTo: `${origin}/login?confirmed=1`, data: { full_name: member.fullName, must_change_password: true } },
  });
  if (error) {
    if (error.code === "weak_password") return { error: error.message };
    if (error.code === "over_email_send_rate_limit") return { error: "Too many emails were sent recently. Try again in an hour." };
    log.error("team", "create account failed", error);
    return { error: "The account could not be created. Try again." };
  }
  // An existing account comes back with no identities and no email is sent.
  if (!data.user?.identities?.length) return { error: "This email already has an account. They can sign in with Google, or use “Forgot password” on the sign-in page." };
  return { confirmationSent: !data.session };
}
