import { cache } from "react";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasAll, toPermissionSet, type Permission, type PermissionSet } from "@/lib/permissions";
import { recentGoogleSignIn } from "@/lib/mfa-policy";
import { DEMO_MODE } from "@/lib/demo";

export const ownerManagedRoles = [
  "administrator",
  "staff",
  "booker",
  "talent_manager",
  "creative",
  "accounting",
  "read_only",
] as const;

// "talent" logins are linked to a talent record (agency_members.talent_id) and use /portal.
export type AgencyRole = "owner" | "talent" | (typeof ownerManagedRoles)[number];

type AgencyProfile = { id: string; email: string; full_name: string; role: string; status: string };
type AgencyMembership = { id: string; email: string; full_name: string; role: AgencyRole; status: "active" | "pending" | "suspended" };

// Roles that must complete two-step sign-in (TOTP) before using the dashboard.
// MFA_REQUIRED_ROLES overrides the default; set it to "none" only in an emergency.
export function mfaRequiredRoles() {
  // Demo mode: sample accounts have no inbox or authenticator, so no second step.
  if (DEMO_MODE) return new Set<string>();
  const configured = process.env.MFA_REQUIRED_ROLES?.trim();
  if (configured === "none") return new Set<string>();
  return new Set((configured || "owner,administrator").split(",").map((role) => role.trim()).filter(Boolean));
}

// One lookup per request: the Auth user, their bound membership, and their
// permissions from the database. RLS enforces the same permissions server-side.
export const getAgencyContext = cache(async () => {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const empty = new Set<Permission>() as PermissionSet;
  if (!user) return { supabase, user: null, profile: null, membership: null, permissions: empty, authorized: false, needsMfa: false } as const;

  const [{ data: profile }, { data: membership }, { data: permissions }, { data: assurance }] = await Promise.all([
    supabase.from("profiles").select("id,email,full_name,role,status").eq("id", user.id).maybeSingle(),
    supabase.from("agency_members").select("id,email,full_name,role,status").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("current_permissions"),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  const permissionSet = toPermissionSet(permissions);
  const typedMembership = membership as AgencyMembership | null;
  // Owner/administrator sessions count only after a second step: an authenticator
  // code (aal2), a Google sign-in from the last 30 days (mfa-policy.ts), or an
  // emailed code entered after a password sign-in, trusted for 30 days (migration 028).
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [user.app_metadata?.provider as string];
  const mfaRole = Boolean(typedMembership && mfaRequiredRoles().has(typedMembership.role));
  let verified = assurance?.currentLevel === "aal2" || recentGoogleSignIn(assurance?.currentAuthenticationMethods, providers);
  if (mfaRole && !verified) verified = (await supabase.rpc("email_mfa_verified")).data === true;
  const needsMfa = mfaRole && !verified;
  const authorized = typedMembership?.status === "active" && permissionSet.has("dashboard.access") && !needsMfa;

  return { supabase, user, profile: profile as AgencyProfile | null, membership: typedMembership, permissions: permissionSet, authorized, needsMfa } as const;
});

export type AgencyContext = Awaited<ReturnType<typeof getAgencyContext>>;
export type AuthorizedContext = AgencyContext & { user: NonNullable<AgencyContext["user"]>; membership: AgencyMembership; authorized: true };

// For API route handlers: returns the context, or a ready 401/403 response.
export async function requireApi(required?: Permission | Permission[]): Promise<{ context: AuthorizedContext } | { response: NextResponse }> {
  const context = await getAgencyContext();
  if (!context.user) return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (context.needsMfa) return { response: NextResponse.json({ error: "Complete two-step sign-in first", code: "mfa_required" }, { status: 403 }) };
  if (!context.authorized) return { response: NextResponse.json({ error: "Your account is not approved for the agency dashboard" }, { status: 403 }) };
  if (required && !hasAll(context.permissions, required)) {
    return { response: NextResponse.json({ error: "You do not have permission to do this" }, { status: 403 }) };
  }
  return { context: context as AuthorizedContext };
}

// For server-rendered dashboard pages: the context if permitted, otherwise null
// (the page renders the Unauthorized state).
export async function requirePage(required?: Permission | Permission[]) {
  const context = await getAgencyContext();
  if (!context.authorized) return null;
  if (required && !hasAll(context.permissions, required)) return null;
  return context as AuthorizedContext;
}

export function displayNameForUser(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }, profile?: { full_name?: string | null } | null) {
  return profile?.full_name ||
    (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "") ||
    (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : "") ||
    user.email?.split("@")[0] ||
    "Agency user";
}
