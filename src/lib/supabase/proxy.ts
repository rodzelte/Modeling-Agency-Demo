import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/env";
import { sandboxOptions } from "@/lib/supabase/sandbox";

// Refreshes the Supabase session and routes people to the right area:
// staff → /dashboard, talent logins → /portal. RLS remains the real boundary;
// this only keeps each group out of the other's screens.
export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = getSupabasePublicEnv();

  const supabase = createServerClient(url, key, {
    ...sandboxOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const redirect = (pathname: string, params: Record<string, string> = {}) => {
    const target = request.nextUrl.clone();
    target.pathname = pathname;
    target.search = "";
    for (const [name, value] of Object.entries(params)) target.searchParams.set(name, value);
    return NextResponse.redirect(target);
  };

  const inDashboard = path.startsWith("/dashboard");
  const inPortal = path.startsWith("/portal") && !path.startsWith("/portal/login");
  if (!inDashboard && !inPortal) return response;

  if (!user) return inPortal ? redirect("/portal/login") : redirect("/login", { next: path });

  const { data: membership } = await supabase.from("agency_members").select("status,role").eq("user_id", user.id).maybeSingle();
  if (membership?.status !== "active") {
    return inPortal ? redirect("/portal/login", { error: "not_invited" }) : redirect("/login", { error: "not_authorized" });
  }
  if (inDashboard && membership.role === "talent") return redirect("/portal");
  if (inPortal && membership.role !== "talent") return redirect("/dashboard");
  return response;
}
