import { NextResponse, after } from "next/server";
import { headerSecret, webhookSecretMatches } from "@/features/ghl/auth";
import { ghlConfigured } from "@/features/ghl/client";
import { drainQueue, enqueueContacts, isGhlId, recordWebhook } from "@/features/ghl/engine";
import { log } from "@/lib/log";

// Change notifications from GHL workflows (Contact Created / Contact Changed /
// Opportunity Created / Pipeline Stage Changed / Opportunity Status Changed /
// Tag Added, each with a Webhook action to this URL). The body is used ONLY to
// learn which contact changed: the server then fetches that contact and its
// opportunities from the GHL API itself, so a forged or replayed body can at
// worst cause a harmless re-sync of a real GHL record. Authenticated by the
// shared secret (X-Webhook-Secret header, or a "webhook_secret" Custom Data
// field for GHL's basic Webhook action). See docs/ghl-integration.md.
export const maxDuration = 60;
const MAX_BODY = 256 * 1024;

const pick = (...values: unknown[]) => values.find((value) => isGhlId(value)) as string | undefined;

export async function POST(request: Request) {
  // Demo mode has no inbound integrations: nothing outside can write to the sandbox.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return NextResponse.json({ error: "Integrations are switched off in demo mode" }, { status: 404 });
  if (!process.env.GHL_WEBHOOK_SECRET || !ghlConfigured()) {
    log.error("ghl", "events webhook called but the integration is not configured");
    return NextResponse.json({ error: "Integration not configured" }, { status: 503 });
  }
  const fromHeader = headerSecret(request);
  if (fromHeader && !webhookSecretMatches(fromHeader)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }
  const custom = (body.customData && typeof body.customData === "object" ? body.customData : {}) as Record<string, unknown>;
  if (!webhookSecretMatches(fromHeader ?? (typeof body.webhook_secret === "string" ? body.webhook_secret : typeof custom.webhook_secret === "string" ? custom.webhook_secret : null))) {
    log.warn("ghl", "events webhook rejected: bad secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contact = (body.contact && typeof body.contact === "object" ? body.contact : {}) as Record<string, unknown>;
  const opportunity = (body.opportunity && typeof body.opportunity === "object" ? body.opportunity : {}) as Record<string, unknown>;
  const contactId = pick(body.contact_id, body.contactId, custom.contact_id, contact.id, opportunity.contact_id, opportunity.contactId, body.id);
  const opportunityId = pick(body.opportunity_id, body.opportunityId, custom.opportunity_id, opportunity.id) ?? null;
  const event = typeof custom.event === "string" ? custom.event : typeof body.type === "string" ? body.type : null;

  if (!contactId) {
    await recordWebhook(event, null, opportunityId, "ignored: no contact id");
    return NextResponse.json({ error: "No contact id in the payload" }, { status: 422 });
  }
  await enqueueContacts([contactId], event ? `webhook: ${event}`.slice(0, 120) : "webhook");
  await recordWebhook(event, contactId, opportunityId, "queued");
  // Process right after responding, so GHL is not kept waiting; anything left
  // over is picked up by the next webhook or the scheduled reconciliation.
  after(async () => {
    try {
      await drainQueue(Date.now() + 50_000);
    } catch (error) {
      log.error("ghl", "queue drain after webhook failed", error);
    }
  });
  return NextResponse.json({ ok: true, queued: contactId }, { status: 202 });
}
