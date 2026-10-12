// One-off: move photos uploaded before migration 009 out of the public bucket.
//
// Legacy rows have storage_bucket = 'talent-public'. For each one this script
//   1. copies the original to talent-private at the same path,
//   2. verifies the private copy exists and has the same size,
//   3. points the row at talent-private,
//   4. removes the public file ONLY if the photo is not published
//      (published photos keep their public copy via public_storage_path).
//
// Dry run by default. Apply with:
//   node --env-file=.env.local scripts/migrate-legacy-media.mjs --apply
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (server-only). Run it
// from a trusted machine; never commit the key.
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. node --env-file=.env.local ...).");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function objectSize(bucket, path) {
  const slash = path.lastIndexOf("/");
  const { data, error } = await supabase.storage.from(bucket).list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 100 });
  if (error) throw error;
  const match = data.find((item) => item.name === path.slice(slash + 1));
  return match ? (match.metadata?.size ?? -1) : null;
}

const { data: rows, error } = await supabase
  .from("talent_photos")
  .select("id, talent_id, storage_path, public_storage_path")
  .eq("storage_bucket", "talent-public")
  .order("created_at");
if (error) throw error;

console.log(`${rows.length} legacy photo(s) in talent-public. ${apply ? "Applying." : "Dry run (pass --apply to move)."}`);
const summary = { moved: 0, keptPublicCopy: 0, removedPublicCopy: 0, missing: 0, failed: 0 };

for (const row of rows) {
  const published = row.public_storage_path === row.storage_path;
  const label = `${row.id} (${published ? "published" : "private"})`;
  try {
    const publicSize = await objectSize("talent-public", row.storage_path);
    if (publicSize === null) {
      console.warn(`  ! ${label}: file not found in talent-public; row left unchanged`);
      summary.missing += 1;
      continue;
    }
    if (!apply) {
      console.log(`  - ${label}: would copy to talent-private${published ? " and keep the public copy" : " and remove the public copy"}`);
      continue;
    }

    if ((await objectSize("talent-private", row.storage_path)) === null) {
      const { error: copyError } = await supabase.storage.from("talent-public").copy(row.storage_path, row.storage_path, { destinationBucket: "talent-private" });
      if (copyError) throw copyError;
    }
    const privateSize = await objectSize("talent-private", row.storage_path);
    if (privateSize === null || (publicSize >= 0 && privateSize >= 0 && privateSize !== publicSize)) {
      throw new Error(`private copy did not verify (public ${publicSize}, private ${privateSize})`);
    }

    const { error: updateError } = await supabase.from("talent_photos")
      .update({ storage_bucket: "talent-private", public_storage_path: published ? row.storage_path : null })
      .eq("id", row.id);
    if (updateError) throw updateError;
    summary.moved += 1;

    if (published) {
      summary.keptPublicCopy += 1;
    } else {
      const { error: removeError } = await supabase.storage.from("talent-public").remove([row.storage_path]);
      if (removeError) throw removeError;
      summary.removedPublicCopy += 1;
    }
    console.log(`  ✓ ${label}`);
  } catch (rowError) {
    summary.failed += 1;
    console.error(`  ✗ ${label}: ${rowError.message ?? rowError}`);
  }
}

console.log(JSON.stringify(summary));
if (summary.failed) process.exit(1);
