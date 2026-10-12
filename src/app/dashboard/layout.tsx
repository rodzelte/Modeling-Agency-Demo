import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ToastProvider } from "@/components/ui/Toast";
import { DashboardFrame } from "@/features/dashboard/DashboardFrame";
import { visibleNav } from "@/features/dashboard/nav";
import { displayNameForUser, getAgencyContext } from "@/lib/agency-auth";
import { profilePhotoUrl } from "@/features/team/photo";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s — 42 Model Management" },
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const context = await getAgencyContext();
  if (!context.user) redirect("/login?next=/dashboard");
  if (context.needsMfa) redirect("/login/mfa?next=/dashboard");
  if (!context.authorized || !context.membership) redirect("/login?error=not_authorized");
  // Signed in with the owner's temporary password: choose their own first.
  if (context.user.user_metadata?.must_change_password === true) redirect("/login/reset");

  const viewer = {
    name: displayNameForUser(context.user, context.profile),
    email: context.user.email ?? "",
    role: context.membership.role,
    avatarUrl: profilePhotoUrl(context.user.user_metadata),
  };

  return <ToastProvider><DashboardFrame nav={visibleNav(context.permissions)} viewer={viewer}>{children}</DashboardFrame></ToastProvider>;
}
