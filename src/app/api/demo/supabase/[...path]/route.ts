import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { DEMO_BRIDGE_PATH, DEMO_SANDBOX_URL } from "@/lib/demo";

// Demo mode only: the door to the in-memory sandbox. The browser's Supabase
// client and every <img> file link come through here, and on a serverless host
// so does the app's own server code (src/demo/remote.ts): this is then the one
// function that holds the sandbox. It is never a proxy: requests are answered
// inside this process. Browser requests can only act as the anonymous or the
// signed-in demo user; only the app's own server code, which knows the
// per-build internal secret, may act as the service role or call /internal/*.
// In a production build the route answers 404 and the sandbox is not bundled.
export const maxDuration = 60;

async function bridge(request: Request) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { INTERNAL_HEADER, internalSecret } = await import("@/demo/remote");
  const secret = Buffer.from(internalSecret());
  const given = Buffer.from(request.headers.get(INTERNAL_HEADER) ?? "");
  const internal = secret.length >= 32 && given.length === secret.length && timingSafeEqual(given, secret);

  const url = new URL(request.url);
  const path = url.pathname.slice(DEMO_BRIDGE_PATH.length);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  if (path.startsWith("/internal/")) {
    if (!internal) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
    const { handleInternal } = await import("@/demo/system");
    return handleInternal(path.slice("/internal/".length), hasBody ? await request.json().catch(() => null) : null);
  }

  const { sandboxFetch } = await import("@/demo/sandbox/fetch");
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_HEADER);
  return sandboxFetch(`${DEMO_SANDBOX_URL}${path}${url.search}`, { method: request.method, headers, body: hasBody ? await request.arrayBuffer() : undefined }, { external: !internal });
}

export const GET = bridge;
export const HEAD = bridge;
export const POST = bridge;
export const PUT = bridge;
export const PATCH = bridge;
export const DELETE = bridge;
