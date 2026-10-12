import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import type { MappedApplication, PhotoKind } from "./ghl";

// Writes a mapped GHL submission with the admin client (the caller has already
// authenticated the webhook). One application per GHL contact: re-submissions
// update it, reopen it if it was rejected/archived, and add any new photos.

const REOPEN = new Set(["rejected", "archived"]);
const MAX_BYTES = 15 * 1024 * 1024;

// Only GHL's own file hosts are fetched, so a payload cannot make the server
// request arbitrary (e.g. internal) URLs. Extend with GHL_FILE_HOSTS if needed.
function allowedHost(url: URL) {
  const extra = (process.env.GHL_FILE_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  const hosts = ["filesafe.space", "leadconnectorhq.com", "msgsndr.com", "storage.googleapis.com", "firebasestorage.googleapis.com", ...extra];
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// Fetches a photo from GHL's file storage (or the hosts `isAllowed` accepts,
// e.g. the CDS media bucket). Every redirect hop must stay on an
// allowed host (an allowed host cannot bounce the server to an internal
// address), and the body is read with a running size cap so a huge or endless
// response is cut off rather than buffered.
export async function downloadPhoto(start: URL, maxBytes = MAX_BYTES, isAllowed: (url: URL) => boolean = allowedHost): Promise<Buffer> {
  let url = start;
  for (let hop = 0; hop <= 3; hop += 1) {
    if (!isAllowed(url)) throw new Error(`host not allowed: ${url.hostname}`);
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`redirect without a location (${response.status})`);
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`download failed with ${response.status}`);
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new Error("file too large");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("file too large"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("too many redirects");
}

export type IngestResult ={ id: string; status: "created" | "updated"; photos: { url: string; kind: PhotoKind }[] };

const SIGNED_NOTE = "Imported from GHL as a signed model (Talent Recruitment Pipeline → Active Talent). Approved automatically; ready to convert to talent.";

export async function upsertApplication(admin: SupabaseClient, mapped: MappedApplication, raw: unknown, options: { signedTalent?: boolean } = {}): Promise<IngestResult> {
  // Incoming blanks never erase what we already have.
  const incoming = Object.fromEntries(Object.entries(mapped.fields).filter(([, value]) => value !== null)) as Partial<MappedApplication["fields"]>;
  const now = new Date().toISOString();

  let existing: { id: string; status: string; extra_fields: Record<string, string> } | null = null;
  if (mapped.externalId) {
    const { data, error } = await admin.from("applications").select("id,status,extra_fields").eq("source", "ghl").eq("external_id", mapped.externalId).maybeSingle();
    if (error) throw error;
    existing = data;
  }

  if (!existing) {
    const { data, error } = await admin.from("applications").insert({
      source: "ghl",
      external_id: mapped.externalId,
      ...incoming,
      submitted_at: incoming.submitted_at ?? now,
      extra_fields: mapped.extra,
      raw_payload: raw,
      ...(options.signedTalent ? { status: "approved" } : {}),
    }).select("id").single();
    if (error) throw error;
    if (options.signedTalent) await admin.from("application_notes").insert({ application_id: data.id, author_id: null, body: SIGNED_NOTE });
    return { id: data.id, status: "created", photos: mapped.photos };
  }

  // A signed model is approved unless it was already approved or converted.
  const approve = options.signedTalent && existing.status !== "approved" && existing.status !== "converted";
  const reopen = !approve && REOPEN.has(existing.status);
  const { submitted_at: _submitted, ...updates } = incoming;
  void _submitted;
  const { error } = await admin.from("applications").update({
    ...updates,
    extra_fields: { ...existing.extra_fields, ...mapped.extra },
    raw_payload: raw,
    last_received_at: now,
    ...(reopen ? { status: "new" } : {}),
    ...(approve ? { status: "approved" } : {}),
  }).eq("id", existing.id);
  if (error) throw error;
  const note = approve ? SIGNED_NOTE : existing.status === "converted"
    ? "Submitted again through GHL after conversion. Check the talent record for changes."
    : reopen ? `Resubmitted through GHL; reopened from "${existing.status}".` : "Updated by a new GHL submission.";
  await admin.from("application_notes").insert({ application_id: existing.id, author_id: null, body: note });
  return { id: existing.id, status: "updated", photos: mapped.photos };
}

// Downloads each new photo, re-encodes it as JPEG (auto-rotated, max 2400px,
// metadata such as GPS stripped) and stores it in the private applications bucket.
export async function storeApplicationPhotos(admin: SupabaseClient, applicationId: string, photos: { url: string; kind: PhotoKind }[]) {
  if (!photos.length) return;
  const { data: known } = await admin.from("application_photos").select("source_url").eq("application_id", applicationId);
  const already = new Set((known ?? []).map((row: { source_url: string | null }) => row.source_url));

  for (const [index, photo] of photos.entries()) {
    if (already.has(photo.url)) continue;
    const record = { application_id: applicationId, kind: photo.kind, source_url: photo.url };
    try {
      const bytes = await downloadPhoto(new URL(photo.url));
      const jpeg = await sharp(bytes, { failOn: "error", limitInputPixels: 80_000_000 })
        .rotate()
        .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
      const path = `${applicationId}/${photo.kind}-${Date.now().toString(36)}-${index}.jpg`;
      const upload = await admin.storage.from("applications").upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
      if (upload.error) throw upload.error;
      await admin.from("application_photos").insert({ ...record, storage_path: path, content_type: "image/jpeg", size_bytes: jpeg.byteLength, status: "stored" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("ghl", "photo not stored", { application: applicationId, kind: photo.kind, error: message.slice(0, 200) });
      await admin.from("application_photos").insert({ ...record, status: "failed", error: message.slice(0, 300) });
    }
  }
}
