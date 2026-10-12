import { redirectTo } from "@/lib/api";

// Demo mode only: the link to share with a prospect. /demo opens the dashboard
// as the sample owner; /demo?as=booker (or any key in src/demo/accounts.ts,
// e.g. talent for the portal) opens it as that person.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return redirectTo("/", 307);
  const { signInDemoAccount, demoHome } = await import("@/demo/session");
  const account = await signInDemoAccount(url.searchParams.get("as") ?? "owner");
  return redirectTo(account ? demoHome(account) : "/login", 303);
}
