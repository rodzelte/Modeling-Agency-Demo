// Demo mode only: one-click sign-in as one of the fictional people in
// src/demo/accounts.ts, through the same Supabase client the real sign-in uses.
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { demoAccount, DEMO_PASSWORD, type DemoAccount } from "./accounts";
import { lit } from "./sandbox/sql";
import { systemRows } from "./system";

export async function signInDemoAccount(key: string | null | undefined): Promise<DemoAccount | null> {
  const account = demoAccount(key);
  if (!account) return null;
  const supabase = await createServerSupabaseClient();
  let { error } = await supabase.auth.signInWithPassword({ email: account.email, password: DEMO_PASSWORD });
  if (error) {
    // A visitor may have tried "change password" on this account; the one-click
    // entry keeps working by putting the sample password back.
    await systemRows(`update auth.users set encrypted_password = crypt(${lit(DEMO_PASSWORD)}, gen_salt('bf', 4)),
      raw_user_meta_data = raw_user_meta_data - 'must_change_password' where id = ${lit(account.id)} returning id`);
    ({ error } = await supabase.auth.signInWithPassword({ email: account.email, password: DEMO_PASSWORD }));
  }
  return error ? null : account;
}

export const demoHome = (account: DemoAccount) => (account.area === "portal" ? "/portal" : "/dashboard");
