import { NextResponse, after } from "next/server";
import { mapGhlPayload } from "@/features/applications/ghl";
import { storeApplicationPhotos, upsertApplication } from "@/features/applications/ingest";
import { webhookSecretMatches } from "@/features/ghl/auth";
import { ghlConfigured } from "@/features/ghl/client";
import { drainQueue, enqueueContacts } from "@/features/ghl/engine";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

// Receives Join Us submissions from GoHighLevel (workflow "Custom Webhook" action)
// and from scripts/import-ghl.mjs. Authenticated by a shared secret: the
// X-Webhook-Secret header (or "Authorization: Bearer <secret>"), or, for GHL's
// basic Webhook action which cannot set headers, a "webhook_secret" Custom Data
// field in the body. Never in the URL. See docs/ghl-integration.md.
// Photos are downloaded after the response is sent.
export const maxDuration = 60;

const MAX_BODY = 512 * 1024;
const secretMatches = webhookSecretMatches;

export async function POST(request: Request) {
  // Demo mode has no inbound integrations: nothing outside can write to the sandbox.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return NextResponse.json({ error: "Integrations are switched off in demo mode" }, { status: 404 });
  if (!process.env.GHL_WEBHOOK_SECRET) {
    log.error("ghl", "webhook called but GHL_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Integration not configured" }, { status: 503 });
  }
  // Cheap checks first: a wrong header secret or an oversized body is refused
  // before anything is read.
  const headerSecret = request.headers.get("x-webhook-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (headerSecret && !secretMatches(headerSecret)) {
    log.warn("ghl", "webhook rejected: bad secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const body = await request.text();
  if (body.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });

  const record = payload as Record<string, unknown> & { customData?: Record<string, unknown> };
  const bodySecret = typeof record.webhook_secret === "string" ? record.webhook_secret
    : typeof record.customData?.webhook_secret === "string" ? record.customData.webhook_secret : null;
  if (!secretMatches(headerSecret ?? bodySecret)) {
    log.warn("ghl", "webhook rejected: bad secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The secret is never stored with the submission.
  delete record.webhook_secret;
  if (record.customData) delete record.customData.webhook_secret;
  // "intake: signed_talent" marks a model already signed in GHL (pipeline stage
  // Active Talent): the application arrives approved, ready to convert.
  const intake = [record.intake, record._intake, record.customData?.intake].find((value) => typeof value === "string");
  const signedTalent = intake === "signed_talent";
  delete record.intake;
  delete record._intake;
  if (record.customData) delete record.customData.intake;

  const fieldNames = (payload as { _fieldNames?: unknown })._fieldNames;
  const mapped = mapGhlPayload(payload, fieldNames && typeof fieldNames === "object" ? fieldNames as Record<string, string> : {});
  if (!mapped.externalId && !mapped.fields.email && !mapped.fields.phone) {
    return NextResponse.json({ error: "Submission has no contact id, email, or phone" }, { status: 422 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const result = await upsertApplication(admin, mapped, payload, { signedTalent });
    after(async () => {
      await storeApplicationPhotos(admin, result.id, result.photos);
      // Also refresh the full CRM mirror (and the linked talent) for this contact.
      if (mapped.externalId && ghlConfigured()) {
        try {
          await enqueueContacts([mapped.externalId], signedTalent ? "webhook: signed talent" : "webhook: form submission");
          await drainQueue(Date.now() + 40_000);
        } catch (error) {
          log.error("ghl", "contact sync after submission failed", error);
        }
      }
    });
    log.info("ghl", `application ${result.status}`, { application: result.id, photos: result.photos.length });
    return NextResponse.json({ ok: true, id: result.id, status: result.status, photos: result.photos.length }, { status: result.status === "created" ? 201 : 200 });
  } catch (error) {
    log.error("ghl", "application could not be saved", error);
    return NextResponse.json({ error: "Could not save the submission" }, { status: 500 });
  }
}
