import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { log } from "@/lib/log";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { maskEmail, NONCE_COOKIE, nonceCookieOptions } from "@/features/auth/email-code";

// Step 1 of the emailed sign-in code: the caller must be signed in with their
// password (checked by start_email_mfa in the database). Emails a 6-digit code
// through Supabase Auth (Magic Link template, {{ .Token }}).
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const { data: nonce, error } = await supabase.rpc("start_email_mfa");
  if (error || typeof nonce !== "string") {
    if (error?.code === "54000") return NextResponse.json({ error: "Too many codes requested. Wait 15 minutes and try again." }, { status: 429 });
    if (error?.code === "42501") return NextResponse.json({ error: "For security, sign in with your password again, then request a code.", code: "password_required" }, { status: 403 });
    log.error("auth", "start email code failed", error);
    return NextResponse.json({ error: "The code could not be sent. Try again." }, { status: 500 });
  }

  const { error: sendError } = await createPublicSupabaseClient().auth.signInWithOtp({ email: user.email, options: { shouldCreateUser: false } });
  if (sendError) {
    if (sendError.code === "over_email_send_rate_limit" || sendError.code === "over_request_rate_limit" || sendError.status === 429) {
      return NextResponse.json({ error: "A code was sent very recently. Wait a minute, then try again." }, { status: 429 });
    }
    log.error("auth", "send email code failed", sendError);
    return NextResponse.json({ error: "The code could not be sent. Try again." }, { status: 500 });
  }

  (await cookies()).set(NONCE_COOKIE, nonce, nonceCookieOptions);
  return NextResponse.json({ sentTo: maskEmail(user.email) });
}
