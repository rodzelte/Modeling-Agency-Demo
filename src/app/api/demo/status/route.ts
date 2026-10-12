import { NextResponse } from "next/server";

// Demo mode only: a plain statement of what this server is connected to, for
// checking the isolation yourself. Lists setting NAMES only, never values.
export const maxDuration = 60;

export async function GET() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [{ sandboxStatus }, { blockedRequests, productionSettingsPresent }, { splitMode }] = await Promise.all([
    import("@/demo/system"), import("@/demo/boot"), import("@/demo/remote"),
  ]);
  const serverless = splitMode();
  return NextResponse.json({
    mode: "demo",
    database: serverless
      ? "in-memory sandbox (PGlite) inside one function of this deployment; it starts again from the sample data whenever the host recycles that function"
      : "in-memory sandbox (PGlite) inside this server process",
    hosting: serverless ? "serverless" : "single server",
    supabaseProject: null,
    productionSettingsPresent: productionSettingsPresent(),
    outboundRequestsBlocked: blockedRequests(),
    sandbox: await sandboxStatus(),
  }, { headers: { "Cache-Control": "no-store" } });
}
