import { safePath } from "@/lib/safe-path";
import { AuthShell } from "./AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

const errors: Record<string, string> = {
  not_authorized: "This email is not approved for the agency dashboard. Ask the owner to add it under Team access.",
  oauth_callback_failed: "Sign-in could not be completed. Please try again.",
  link_expired: "That link has expired or was already used. Request a new one below.",
  demo_google: "Google sign-in is switched off in the demo. Choose a demo account instead.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; reset?: string; confirmed?: string }> }) {
  const params = await searchParams;
  const nextPath = safePath(params.next, "/dashboard");
  // Demo builds offer one-click sample accounts; production builds never load this.
  const DemoAccounts = process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? (await import("@/features/demo/DemoAccounts")).DemoAccounts : null;
  return <AuthShell eyebrow="Private workspace" title="Welcome back." intro="Sign in with your agency account to manage talent, media, boards, and publishing.">
    {DemoAccounts && <DemoAccounts area="dashboard" />}
    <LoginForm nextPath={nextPath} initialError={errors[params.error ?? ""] ?? ""} initialNotice={params.reset === "done" ? "Your password was updated. Sign in with the new password." : params.confirmed ? "Your email is confirmed. Sign in with the temporary password you were given." : ""} />
  </AuthShell>;
}
