import { NextResponse, after } from "next/server";
import { cronAuthorized } from "@/features/ghl/auth";
import { reconcile } from "@/features/ghl/engine";
import { log } from "@/lib/log";
import { siteOrigin } from "@/lib/site";

// Scheduled reconciliation (safety net for missed webhooks). Called by Vercel
// Cron (GET, daily) and the GitHub Actions schedule (POST, hourly), both with
// "Authorization: Bearer <CRON_SECRET>". Each call works for ~50 seconds; if the
// run is not finished it calls itself again (at most 30 hops) to continue.
export const maxDuration = 60;
const MAX_HOPS = 30;

async function run(request: Request) {
  // Demo mode has no inbound integrations: nothing outside can write to the sandbox.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return NextResponse.json({ error: "Integrations are switched off in demo mode" }, { status: 404 });
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const hop = Math.min(Number(request.headers.get("x-sync-hop") ?? 0) || 0, MAX_HOPS);
  try {
    const result = await reconcile("cron", Date.now() + 50_000, null, hop > 0);
    const origin = siteOrigin() ?? new URL(request.url).origin;
    if (!result.done && !("busy" in result && result.busy) && hop < MAX_HOPS) {
      after(() => fetch(new URL("/api/integrations/ghl/sync", origin), {
        method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, "x-sync-hop": String(hop + 1) },
      }).then((response) => response.body?.cancel()).catch((error) => log.error("ghl", "could not continue reconcile", error)));
    }
    return NextResponse.json({ run: result.runId, done: result.done, stats: result.stats });
  } catch (error) {
    log.error("ghl", "scheduled reconcile failed", error);
    return NextResponse.json({ error: "Sync failed; see the GHL Sync page" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
