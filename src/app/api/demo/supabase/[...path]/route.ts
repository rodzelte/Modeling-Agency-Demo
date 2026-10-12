import { NextResponse } from "next/server";
import { DEMO_BRIDGE_PATH, DEMO_SANDBOX_URL } from "@/lib/demo";

// Demo mode only: the browser's Supabase client and every <img> file link reach
// the in-memory sandbox through this same-origin route. It is never a proxy:
// requests are answered inside this process and can only act as the anonymous
// or the signed-in demo user (never the service role). In a production build
// the route answers 404 and the sandbox code is not bundled.
async function bridge(request: Request) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { sandboxFetch } = await import("@/demo/sandbox/fetch");
  const url = new URL(request.url);
  const target = `${DEMO_SANDBOX_URL}${url.pathname.slice(DEMO_BRIDGE_PATH.length)}${url.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return sandboxFetch(target, { method: request.method, headers: request.headers, body: hasBody ? await request.arrayBuffer() : undefined }, { external: true });
}

export const GET = bridge;
export const HEAD = bridge;
export const POST = bridge;
export const PUT = bridge;
export const PATCH = bridge;
export const DELETE = bridge;
