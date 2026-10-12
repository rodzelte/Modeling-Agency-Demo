import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { PUBLIC_SITE_TAG } from "@/features/public/cache";

// Demo mode only: "Reset demo data". Throws away everything changed since the
// sandbox started and restores the original sample records and files.
export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Only this site's own pages may trigger it: another site cannot add a custom
  // header to a cross-site request. (Works behind any proxy or domain.)
  if (request.headers.get("x-demo-reset") !== "1") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { resetSandbox } = await import("@/demo/sandbox/database");
  const sandbox = await resetSandbox();
  revalidateTag(PUBLIC_SITE_TAG, { expire: 0 });
  return NextResponse.json({ ok: true, resets: sandbox.resets });
}
