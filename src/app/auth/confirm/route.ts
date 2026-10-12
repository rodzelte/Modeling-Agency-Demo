import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safePath } from "@/lib/safe-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const types: EmailOtpType[] = ["recovery", "magiclink", "email", "invite", "signup", "email_change"];

// Email links (password reset, magic link, invite) that carry a token_hash. Unlike
// the PKCE /auth/callback flow, this works when the email is opened on a different
// device from the one that requested it. Supabase email templates link here:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/login/reset
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const nextParam = url.searchParams.get("next");
  const fallback = type === "recovery" ? "/login/reset" : "/dashboard";
  const next = safePath(nextParam, fallback);

  if (tokenHash && type && types.includes(type)) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL(`${next.startsWith("/portal") ? "/portal/login" : "/login"}?error=link_expired`, url.origin));
}
