import { NextResponse } from "next/server";

// Demo mode only: a plain statement of what this server is connected to, for
// checking the isolation yourself. Lists setting NAMES only, never values.
export async function GET() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [{ getSandbox }, { blockedRequests, productionSettingsPresent }, { seedDemo }] = await Promise.all([
    import("@/demo/sandbox/database"), import("@/demo/boot"), import("@/demo/seed/index"),
  ]);
  const sandbox = await getSandbox(seedDemo);
  return NextResponse.json({
    mode: "demo",
    database: "in-memory sandbox (PGlite) inside this server process",
    supabaseProject: null,
    productionSettingsPresent: productionSettingsPresent(),
    outboundRequestsBlocked: blockedRequests(),
    sandbox: { seededAt: new Date(sandbox.seededAt).toISOString(), resets: sandbox.resets, files: sandbox.files.size },
  }, { headers: { "Cache-Control": "no-store" } });
}
