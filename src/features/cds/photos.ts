import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadPhoto } from "@/features/applications/ingest";
import { publicCopyChanges } from "@/features/media/publish";
import { writeAudit } from "@/lib/api";
import { log } from "@/lib/log";
import { slugify } from "@/lib/validation";
import { isCdsMediaUrl, pickCover, selectPhotos, type MediaItem, type PortfolioRef } from "./logic";

// Photo copy for the CDS import ("4. Copy photos" in Dashboard → CDS Import).
// The owner's WebForFashion window reads each talent's signed photo links and
// posts them here; the server downloads each original from the CDS bucket,
// re-encodes it (2400px JPEG), stores it in talent-private and records it in
// talent_photos (source 'cds', external_id = WebForFashion media id, so a re-run
// never copies twice). Runs as the signed-in owner: RLS and storage policies apply.

type Linked = { cds_id: string; wff_id: string; talent_id: string; match_status: string; portfolios: PortfolioRef[] };

async function linkedTalents(supabase: SupabaseClient, wffId?: string) {
  let query = supabase.from("cds_talents").select("cds_id,wff_id,talent_id,match_status,portfolios")
    .eq("excluded", false).not("talent_id", "is", null).not("wff_id", "is", null).in("match_status", ["created", "matched"]);
  if (wffId) query = query.eq("wff_id", wffId);
  const { data, error } = await query.limit(1000);
  if (error) throw error;
  return (data ?? []) as Linked[];
}

async function mediaOf(supabase: SupabaseClient, cdsIds: string[]) {
  const rows: (MediaItem & { cds_id: string; status: string; photo_id: string | null })[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from("cds_media").select("wff_media_id,cds_id,kind,position,metadata,status,photo_id")
      .in("cds_id", cdsIds).order("wff_media_id").range(start, start + 999);
    if (error) throw error;
    rows.push(...(data ?? []).map((row) => ({ id: row.wff_media_id, cds_id: row.cds_id, kind: row.kind, position: row.position, metadata: row.metadata ?? {}, status: row.status, photo_id: row.photo_id })));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

// Decides what to copy for every linked talent and marks the rest "skipped".
// Talents that were already in the dashboard only get photos if they have none,
// so a gallery staff curated is never doubled. Returns the work list for the
// WebForFashion window: [{ wff_id, name, media: [ids still to copy] }].
export async function planPhotos(supabase: SupabaseClient) {
  const talents = await linkedTalents(supabase);
  if (!talents.length) return { talents: [], selected: 0, imported: 0, skipped: 0 };
  const media = await mediaOf(supabase, talents.map((t) => t.cds_id));
  const { data: existing, error } = await supabase.from("talent_photos").select("talent_id,source").in("talent_id", talents.map((t) => t.talent_id)).is("archived_at", null);
  if (error) throw error;
  const hasOwnPhotos = new Set((existing ?? []).filter((p) => p.source !== "cds").map((p) => p.talent_id));
  const { data: names } = await supabase.from("talent").select("id,display_name").in("id", talents.map((t) => t.talent_id));
  const nameOf = new Map((names ?? []).map((row) => [row.id, row.display_name as string]));

  const plan: { wff_id: string; name: string; media: string[] }[] = [];
  const skip: string[] = [];
  let selected = 0, imported = 0;
  for (const talent of talents) {
    const own = media.filter((m) => m.cds_id === talent.cds_id);
    const wanted = new Set(talent.match_status === "matched" && hasOwnPhotos.has(talent.talent_id) ? [] : selectPhotos(own, talent.portfolios ?? []));
    for (const item of own) if (!wanted.has(item.id) && item.status === "listed") skip.push(item.id);
    selected += wanted.size;
    const todo = own.filter((m) => wanted.has(m.id) && m.status !== "imported");
    imported += wanted.size - todo.length;
    if (todo.length || own.some((m) => wanted.has(m.id) && m.status === "imported")) plan.push({ wff_id: talent.wff_id, name: nameOf.get(talent.talent_id) ?? talent.cds_id, media: todo.map((m) => m.id) });
  }
  for (let start = 0; start < skip.length; start += 500) {
    const { error: skipError } = await supabase.from("cds_media").update({ status: "skipped", error: "Not selected (outside portfolios, digitals and cover)", updated_at: new Date().toISOString() }).in("wff_media_id", skip.slice(start, start + 500));
    if (skipError) throw skipError;
  }
  return { talents: plan, selected, imported, skipped: skip.length };
}

// Copies the posted photos (a few per request; Vercel allows 60 s).
export async function copyPhotos(supabase: SupabaseClient, items: { id: string; url: string }[]) {
  const result = { imported: 0, duplicate: 0, failed: 0, errors: [] as string[] };
  const { data: rows, error } = await supabase.from("cds_media").select("wff_media_id,cds_id,kind,position,status").in("wff_media_id", items.map((i) => i.id));
  if (error) throw error;
  const { data: owners, error: ownerError } = await supabase.from("cds_talents").select("cds_id,talent_id").in("cds_id", [...new Set((rows ?? []).map((r) => r.cds_id))]);
  if (ownerError) throw ownerError;
  const talentOf = new Map((owners ?? []).map((o) => [o.cds_id, o.talent_id as string | null]));

  await Promise.all(items.map(async (item) => {
    const row = (rows ?? []).find((r) => r.wff_media_id === item.id);
    const talentId = row ? talentOf.get(row.cds_id) : null;
    if (!row || !talentId || row.status === "imported") return;
    const mark = (values: Record<string, unknown>) => supabase.from("cds_media").update({ ...values, updated_at: new Date().toISOString() }).eq("wff_media_id", item.id);
    try {
      const url = new URL(item.url);
      if (!isCdsMediaUrl(url)) throw new Error("not a CDS media link");
      const bytes = await downloadPhoto(url, 60 * 1024 * 1024, isCdsMediaUrl);
      const sha = createHash("sha256").update(bytes).digest("hex");
      const { data: same } = await supabase.from("talent_photos").select("id").eq("talent_id", talentId).eq("content_sha256", sha).limit(1).maybeSingle();
      if (same) { await mark({ status: "imported", photo_id: same.id, error: null }); result.duplicate += 1; return; }

      const { data: jpeg, info } = await sharp(bytes, { failOn: "error", limitInputPixels: 120_000_000 }).rotate()
        .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      const path = `talent/${talentId}/cds-${item.id}.jpg`;
      const upload = await supabase.storage.from("talent-private").upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
      if (upload.error) throw upload.error;
      const { data: inserted, error: insertError } = await supabase.from("talent_photos").insert({
        talent_id: talentId, storage_path: path, storage_bucket: "talent-private", public: false, publish_to_website: false,
        image_type: row.kind === "digital" ? "digital" : "portfolio", title: row.kind === "digital" ? "Digital" : null,
        original_file_name: `cds-${item.id}.jpg`, mime_type: "image/jpeg", file_size: jpeg.byteLength, width: info.width, height: info.height,
        source: "cds", external_id: item.id, source_url: `${url.origin}${url.pathname}`, content_sha256: sha,
        synced_at: new Date().toISOString(), display_order: row.position,
      }).select("id").single();
      // Already recorded by an earlier, interrupted run: keep that row.
      let photo = inserted;
      if (insertError?.code === "23505") photo = (await supabase.from("talent_photos").select("id").eq("talent_id", talentId).eq("external_id", item.id).single()).data;
      else if (insertError) throw insertError;
      if (!photo) throw new Error("photo not saved");
      await mark({ status: "imported", photo_id: photo.id, error: null });
      result.imported += 1;
    } catch (failure) {
      const message = (failure instanceof Error ? failure.message : String((failure as { message?: string })?.message ?? failure)).slice(0, 200);
      log.warn("cds", "photo not copied", { media: item.id, error: message });
      await mark({ status: "failed", error: message });
      result.failed += 1;
      result.errors.push(`${item.id}: ${message}`);
    }
  }));
  return result;
}

// Once a talent's photos are in: profile picture, one portfolio per CDS
// portfolio (the same names that place them on boards), a Digitals book, and
// public copies of the cover and the photos WebForFashion marks WEB, so the
// talent is ready the moment staff publish them. Draft talents stay off the site.
export async function finishTalentPhotos(supabase: SupabaseClient, wffId: string) {
  const [talent] = await linkedTalents(supabase, wffId);
  if (!talent) return { cover: false, portfolios: 0, published: 0 };
  const media = await mediaOf(supabase, [talent.cds_id]);
  const copied = new Map(media.filter((m) => m.status === "imported" && m.photo_id).map((m) => [m.id, m.photo_id as string]));
  if (!copied.size) return { cover: false, portfolios: 0, published: 0 };
  const portfolios = (talent.portfolios ?? []).filter((p) => p.media.some((id) => copied.has(id)));
  const result = { cover: false, portfolios: 0, published: 0 };

  const { data: current } = await supabase.from("talent_photos").select("id").eq("talent_id", talent.talent_id).eq("featured", true).is("archived_at", null).limit(1);
  const coverId = pickCover(media, portfolios, new Set(copied.keys()));
  if (coverId && (talent.match_status === "created" || !current?.length)) {
    const { error } = await supabase.rpc("set_featured_photo", { target_talent: talent.talent_id, photo: copied.get(coverId) });
    if (error) throw error;
    result.cover = true;
  }

  for (const [index, portfolio] of portfolios.entries()) {
    const slug = slugify(portfolio.name) || `portfolio-${index + 1}`;
    const { data: saved, error } = await supabase.from("portfolios").upsert({
      talent_id: talent.talent_id, name: portfolio.name, slug, public: Boolean(portfolio.website), display_order: index,
      updated_at: new Date().toISOString(),
    }, { onConflict: "talent_id,slug" }).select("id").single();
    if (error || !saved) throw error ?? new Error("portfolio not saved");
    const photoIds = portfolio.media.map((id) => copied.get(id)).filter((id): id is string => Boolean(id));
    const { error: imagesError } = await supabase.rpc("set_portfolio_images", { target_portfolio: saved.id, photo_ids: photoIds });
    if (imagesError) throw imagesError;
    result.portfolios += 1;
  }

  const digitals = media.filter((m) => m.kind === "digital" && copied.has(m.id)).sort((a, b) => a.position - b.position);
  if (digitals.length) {
    const { data: book } = await supabase.from("digital_books").select("id").eq("talent_id", talent.talent_id).eq("name", "Digitals").maybeSingle();
    const bookId = book?.id ?? (await supabase.from("digital_books").insert({ talent_id: talent.talent_id, name: "Digitals", public: false }).select("id").single()).data?.id;
    if (bookId) {
      const { error } = await supabase.rpc("set_digital_book_images", { target_book: bookId, photo_ids: digitals.map((m) => copied.get(m.id)) });
      if (error) throw error;
    }
  }

  // Public copies: the cover and the WEB-marked photos (a few per talent).
  const publish = new Set(media.filter((m) => copied.has(m.id) && (m.id === coverId || m.metadata.web === true)).map((m) => copied.get(m.id) as string));
  if (publish.size) {
    const { data: photos, error } = await supabase.from("talent_photos").select("id,storage_path,storage_bucket,public_storage_path,review_status").in("id", [...publish]);
    if (error) throw error;
    for (const photo of photos ?? []) {
      if (photo.public_storage_path) continue;
      const { changes, error: copyError } = await publicCopyChanges(supabase, talent.talent_id, photo, true);
      if (copyError) { log.warn("cds", "public copy failed", { photo: photo.id, error: copyError.message }); continue; }
      const { error: updateError } = await supabase.from("talent_photos").update(changes).eq("id", photo.id);
      if (updateError) { log.warn("cds", "public flag failed", { photo: photo.id, error: updateError.message }); continue; }
      result.published += 1;
    }
  }

  await writeAudit(supabase, { action: "talent.photos_imported", entityType: "talent", entityId: talent.talent_id, metadata: { source: "cds", photos: copied.size, portfolios: result.portfolios } });
  return result;
}
