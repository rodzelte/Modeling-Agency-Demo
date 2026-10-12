import { NextResponse } from "next/server";

// Demo mode only: signs the visitor in as one of the sample accounts.
export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { signInDemoAccount, demoHome } = await import("@/demo/session");
  const body = await request.json().catch(() => null) as { account?: unknown } | null;
  const account = await signInDemoAccount(typeof body?.account === "string" ? body.account : null);
  if (!account) return NextResponse.json({ error: "That demo account is not available. Reset the demo data and try again." }, { status: 400 });
  return NextResponse.json({ redirect: demoHome(account), name: account.name, role: account.label });
}
