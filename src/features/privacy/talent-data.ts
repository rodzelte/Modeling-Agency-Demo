import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Every table that holds data about one talent (data-subject access and erasure).
export const TALENT_TABLES = [
  "talent_private_details", "talent_addresses", "talent_contacts", "talent_contact_methods", "talent_social_accounts",
  "talent_measurements", "talent_skills", "talent_agencies", "talent_legal", "talent_banking", "talent_medical",
  "talent_documents", "talent_photos", "talent_videos", "talent_notes", "talent_items", "talent_usages", "talent_appointments",
  "talent_rates", "talent_board_assignments", "talent_change_requests", "talent_availability", "booking_talent", "package_items",
] as const;

export async function collectTalentData(supabase: SupabaseClient, talentId: string) {
  const { data: talent, error } = await supabase.from("talent").select("*").eq("id", talentId).maybeSingle();
  if (error) throw error;
  if (!talent) return null;
  const sections = await Promise.all(TALENT_TABLES.map(async (table) => {
    const { data, error: tableError } = await supabase.from(table).select("*").eq("talent_id", talentId);
    return [table, tableError ? { error: "not readable with your permissions" } : data ?? []] as const;
  }));
  const { data: applications } = await supabase.from("applications").select("id,status,first_name,last_name,email,phone,date_of_birth,city,state,message,submitted_at,extra_fields").eq("converted_talent_id", talentId);
  return { exported_at: new Date().toISOString(), talent, ...Object.fromEntries(sections), applications: applications ?? [] };
}

// Storage objects that belong to the talent, grouped by bucket.
export async function talentFiles(supabase: SupabaseClient, talentId: string) {
  const [photos, videos, documents] = await Promise.all([
    supabase.from("talent_photos").select("storage_bucket,storage_path,public_storage_path").eq("talent_id", talentId),
    supabase.from("talent_videos").select("storage_path,public_storage_path").eq("talent_id", talentId),
    supabase.from("talent_documents").select("storage_path").eq("talent_id", talentId),
  ]);
  const files: Record<string, Set<string>> = { "talent-private": new Set(), "talent-public": new Set(), "talent-documents": new Set() };
  for (const row of (photos.data ?? []) as { storage_bucket: string; storage_path: string | null; public_storage_path: string | null }[]) {
    if (row.storage_path) files[row.storage_bucket === "talent-public" ? "talent-public" : "talent-private"].add(row.storage_path);
    if (row.public_storage_path) files["talent-public"].add(row.public_storage_path);
  }
  for (const row of (videos.data ?? []) as { storage_path: string | null; public_storage_path: string | null }[]) {
    if (row.storage_path) files["talent-private"].add(row.storage_path);
    if (row.public_storage_path) files["talent-public"].add(row.public_storage_path);
  }
  for (const row of (documents.data ?? []) as { storage_path: string | null }[]) if (row.storage_path) files["talent-documents"].add(row.storage_path);
  // Anything else under the talent's folders (e.g. portal uploads never recorded).
  for (const bucket of ["talent-private", "talent-public"] as const) {
    for (const folder of [`talent/${talentId}`, `talent/${talentId}/portal`]) {
      const { data } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
      for (const item of data ?? []) if (item.id) files[bucket].add(`${folder}/${item.name}`);
    }
  }
  return Object.fromEntries(Object.entries(files).map(([bucket, paths]) => [bucket, [...paths]])) as Record<"talent-private" | "talent-public" | "talent-documents", string[]>;
}
