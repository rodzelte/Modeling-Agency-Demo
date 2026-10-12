import type { Instrumentation } from "next";
import { errorDetails, log } from "@/lib/log";

// Demo mode only (never part of a production build): scrub real credentials from
// the process, block outbound requests and start the in-memory sandbox.
export async function register() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true" && process.env.NEXT_RUNTIME === "nodejs") {
    const demo = await import("@/demo/boot");
    demo.startDemo();
  }
}

// Every server error Next.js captures (pages, route handlers, proxy) is logged as
// structured JSON. When ERROR_ALERT_WEBHOOK_URL is set (Slack, Discord, or any
// monitoring endpoint), a short alert is also posted there. Headers, cookies and
// query strings are never forwarded.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const path = request.path.split("?")[0];
  const details = { path, method: request.method, route: context.routePath, type: context.routeType };
  log.error("server", "request failed", error, details);

  const webhook = process.env.ERROR_ALERT_WEBHOOK_URL;
  // Demo mode sends nothing anywhere.
  if (!webhook || process.env.NEXT_PUBLIC_DEMO_MODE === "true") return;
  const { code, digest, error: message } = errorDetails(error);
  const text = `42 Model Management error on ${request.method} ${path} (${context.routeType}): ${message ?? "unknown"}${code ? ` [${code}]` : ""}${digest ? ` digest ${digest}` : ""}`;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (alertError) {
    log.warn("server", "error alert webhook failed", errorDetails(alertError));
  }
};
