import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { log } from "@/lib/log";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NONCE_COOKIE, nonceCookieOptions } from "@/features/auth/email-code";

const bodySchema = z.object({ code: z.string().transform((value) => value.replace(/\s/g, "")).pipe(z.string().regex(/^\d{6,10}$/, "Enter the code from the email")) });

// Step 2: checks the emailed code. A correct code starts a new session (Supabase
// email sign-in); complete_email_mfa then accepts that session as the second step
// only with the nonce issued to this browser after its password sign-in.
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the code from the email." }, { status: 400 });

  const cookieStore = await cookies();
  const nonce = cookieStore.get(NONCE_COOKIE)?.value;
  if (!nonce) return NextResponse.json({ error: "That code has expired. Request a new one." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const { error: otpError } = await supabase.auth.verifyOtp({ email: user.email, token: parsed.data.code, type: "email" });
  if (otpError) return NextResponse.json({ error: "That code didn’t work. Check the newest email, or request a new code." }, { status: 400 });

  const { data: ok, error } = await supabase.rpc("complete_email_mfa", { p_nonce: nonce });
  cookieStore.set(NONCE_COOKIE, "", { ...nonceCookieOptions, maxAge: 0 });
  if (error || ok !== true) {
    if (error) log.error("auth", "complete email code failed", error);
    // Never leave a code-only session behind.
    await supabase.auth.signOut();
    return NextResponse.json({ error: "For security, please sign in with your password again.", code: "password_required" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
