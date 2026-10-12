// Creates a file for every storage path the seeded records point to, so photos,
// documents and website images all open in the demo. The records come from
// supabase/demo/seed.sql; this only supplies the bytes and the storage rows.
//
// Pictures are generated silhouettes unless you supply your own (licensed)
// images in supabase/demo/photos/:
//   <talent-slug>/*.jpg   that talent's photos, in file-name order
//   _any/*.jpg            shared pool for everyone without a folder of their own
//   _site/*.jpg           website images (hero banners, page blocks)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import type { StoredFile } from "../sandbox/database.ts";
import { landscape, portrait, samplePdf, type Art } from "./art.ts";

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

type Photo = { id: string; talent_id: string; slug: string; storage_bucket: string; storage_path: string; public_storage_path: string | null };

function ownPhotos(folder: string): string[] {
  const directory = join(process.cwd(), "supabase", "demo", "photos", folder);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => /\.(jpe?g|png|webp)$/i.test(name)).sort().map((name) => join(directory, name));
}

// A supplied picture, re-encoded like an upload (rotated upright, at most 1600 px).
async function supplied(path: string, width: number): Promise<Art> {
  const { data, info } = await sharp(readFileSync(path)).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), width: info.width, height: info.height, contentType: "image/jpeg" };
}

// Runs the jobs a few at a time (image encoding uses a small thread pool).
async function inBatches(jobs: (() => Promise<void>)[], size = 8) {
  for (let start = 0; start < jobs.length; start += size) await Promise.all(jobs.slice(start, start + size).map((job) => job()));
}

export async function seedFiles(db: PGlite, files: Map<string, StoredFile>): Promise<void> {
  const objects: string[] = [];
  const put = (bucket: string, name: string, bytes: Uint8Array, contentType: string) => {
    if (files.has(`${bucket}/${name}`)) return;
    files.set(`${bucket}/${name}`, { bytes, contentType });
    objects.push(`(${quote(bucket)}, ${quote(name)}, ${quote(JSON.stringify({ size: bytes.byteLength, mimetype: contentType }))}::jsonb)`);
  };
  const pool = ownPhotos("_any");
  const sitePool = ownPhotos("_site");
  const folders = new Map<string, string[]>();
  const own = (slug: string) => {
    if (!folders.has(slug)) folders.set(slug, ownPhotos(slug));
    return folders.get(slug)!;
  };
  const jobs: (() => Promise<void>)[] = [];

  // Talent photos: the private original, plus the public copy when promoted.
  const photos = (await db.query<Photo>(
    `select p.id, p.talent_id, t.slug, p.storage_bucket, p.storage_path, p.public_storage_path
     from public.talent_photos p join public.talent t on t.id = p.talent_id order by p.talent_id, p.display_order, p.created_at, p.id`,
  )).rows;
  const perTalent = new Map<string, number>();
  const talentOrder = new Map<string, number>();
  const details: string[] = [];
  for (const photo of photos) {
    const index = perTalent.get(photo.talent_id) ?? 0;
    perTalent.set(photo.talent_id, index + 1);
    if (!talentOrder.has(photo.talent_id)) talentOrder.set(photo.talent_id, talentOrder.size);
    const mine = own(photo.slug);
    // Pool pictures are dealt out so neighbouring talents start on different ones.
    const source = mine.length ? mine[index % mine.length] : pool.length ? pool[(talentOrder.get(photo.talent_id)! * 5 + index) % pool.length] : null;
    jobs.push(async () => {
      const art = source ? await supplied(source, 1600) : await portrait(photo.talent_id, index);
      put(photo.storage_bucket, photo.storage_path, art.bytes, art.contentType);
      if (photo.public_storage_path) put("talent-public", photo.public_storage_path, art.bytes, art.contentType);
      details.push(`(${quote(photo.id)}::uuid, ${art.width}, ${art.height}, ${art.bytes.byteLength})`);
    });
  }

  // Application snapshots.
  const applicationPhotos = (await db.query<{ application_id: string; storage_path: string | null }>(
    "select application_id, storage_path from public.application_photos where storage_path is not null order by application_id, storage_path",
  )).rows;
  const perApplication = new Map<string, number>();
  for (const photo of applicationPhotos) {
    const index = perApplication.get(photo.application_id) ?? 0;
    perApplication.set(photo.application_id, index + 1);
    const source = pool.length ? pool[(perApplication.size * 7 + index) % pool.length] : null;
    jobs.push(async () => {
      const art = source ? await supplied(source, 1200) : await portrait(photo.application_id, index);
      put("applications", photo.storage_path!, art.bytes, art.contentType);
    });
  }

  // Website images: any cms/... path named in the settings or in a page's blocks.
  const cms = (await db.query<{ body: string }>(`select coalesce(string_agg(doc, ' '), '') as body from (
      select value::text as doc from public.website_settings
      union all select to_jsonb(p)::text from public.website_pages p
      union all select to_jsonb(r)::text from public.website_page_revisions r) s`)).rows[0].body;
  [...new Set(cms.match(/cms\/[A-Za-z0-9/_.-]+\.(?:jpe?g|png|webp)/gi) ?? [])].sort().forEach((path, index) => {
    const source = sitePool.length ? sitePool[index % sitePool.length] : null;
    jobs.push(async () => {
      const art = source ? await supplied(source, 2000) : await landscape(path);
      put("cms-media", path, art.bytes, art.contentType);
    });
  });

  await inBatches(jobs);

  // Documents.
  const documents = (await db.query<{ storage_path: string; file_name: string }>("select storage_path, file_name from public.talent_documents")).rows;
  for (const document of documents) put("talent-documents", document.storage_path, samplePdf(document.file_name, "42 Model Management demo"), "application/pdf");

  // Bulk bookkeeping without firing audit triggers: this is setup, not activity.
  await db.exec("set session_replication_role = replica");
  try {
    if (details.length) {
      await db.exec(`update public.talent_photos p set width = d.width, height = d.height, file_size = d.size, mime_type = 'image/jpeg'
        from (values ${details.join(", ")}) as d(id, width, height, size) where p.id = d.id`);
    }
    for (let start = 0; start < objects.length; start += 200) {
      await db.exec(`insert into storage.objects (bucket_id, name, metadata) values ${objects.slice(start, start + 200).join(", ")} on conflict (bucket_id, name) do nothing`);
    }
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}
