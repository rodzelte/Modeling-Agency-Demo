import { NextResponse } from "next/server";
import { safePath } from "@/lib/safe-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safePath(requestUrl.searchParams.get("next"), "/dashboard");
  // Email links (password reset, magic link) fail when expired or reused.
  const failure = next.startsWith("/login/reset") || next.startsWith("/portal") ? "link_expired" : "oauth_callback_failed";

  if (!code) {
    return NextResponse.redirect(new URL(`${next.startsWith("/portal") ? "/portal/login" : "/login"}?error=${failure}`, requestUrl.origin));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL(`${next.startsWith("/portal") ? "/portal/login" : "/login"}?error=${failure}`, requestUrl.origin));
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
