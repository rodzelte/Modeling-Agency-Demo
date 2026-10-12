import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";

export const APPLICATION_STATUSES = ["new", "reviewing", "info_requested", "approved", "rejected", "archived", "converted"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: "New", reviewing: "Reviewing", info_requested: "Info requested", approved: "Approved", rejected: "Rejected", archived: "Archived", converted: "Converted",
};

const LIST_COLUMNS = "id,status,first_name,last_name,email,phone,city,state,date_of_birth,is_minor,height_cm,submitted_at,last_received_at,converted_talent_id";
const DETAIL_COLUMNS = `${LIST_COLUMNS},source,external_id,gender,address,postal_code,country,instagram,bust_cm,waist_cm,hips_cm,dress_size,shoe_size,hair_color,eye_color,message,guardian_name,guardian_email,guardian_phone,sms_consent,sms_consent_text,extra_fields,reviewed_by,reviewed_at,converted_at`;

export type ApplicationListRow = {
  id: string; status: ApplicationStatus; first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
  city: string | null; state: string | null; date_of_birth: string | null; is_minor: boolean; height_cm: number | null;
  submitted_at: string; last_received_at: string; converted_talent_id: string | null; thumbnail?: string | null;
};

export type ApplicationDetail = ApplicationListRow & {
  source: string; external_id: string | null; gender: string | null; address: string | null; postal_code: string | null; country: string | null;
  instagram: string | null; bust_cm: number | null; waist_cm: number | null; hips_cm: number | null; dress_size: string | null; shoe_size: string | null;
  hair_color: string | null; eye_color: string | null; message: string | null; guardian_name: string | null; guardian_email: string | null;
  guardian_phone: string | null; sms_consent: boolean | null; sms_consent_text: string | null; extra_fields: Record<string, string>;
  reviewed_by: string | null; reviewed_at: string | null; converted_at: string | null;
};

export const PAGE_SIZE = 40;
export const applicantName = (row: Pick<ApplicationListRow, "first_name" | "last_name" | "email">) =>
  [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || "Unnamed applicant";

// Open = everything still needing a decision.
export async function listApplications(supabase: SupabaseClient, filters: { status?: string; q?: string; page?: number }) {
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase.from("applications").select(LIST_COLUMNS, { count: "exact" });
  if (filters.status && (APPLICATION_STATUSES as readonly string[]).includes(filters.status)) query = query.eq("status", filters.status);
  else if (filters.status !== "all") query = query.in("status", ["new", "reviewing", "info_requested", "approved"]);
  const term = (filters.q ?? "").replace(/[,()%*\\:]/g, " ").trim().slice(0, 80);
  if (term) query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,city.ilike.%${term}%`);
  const { data, count, error } = await query.order("submitted_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw error;
  const rows = (data ?? []) as ApplicationListRow[];

  // One headshot (or first stored photo) per row, as short-lived signed URLs.
  if (rows.length) {
    const { data: photos } = await supabase.from("application_photos").select("application_id,kind,storage_path")
      .in("application_id", rows.map((row) => row.id)).eq("status", "stored").order("created_at");
    const pick = new Map<string, string>();
    for (const photo of (photos ?? []) as { application_id: string; kind: string; storage_path: string }[]) {
      if (!pick.has(photo.application_id) || photo.kind === "headshot") pick.set(photo.application_id, photo.storage_path);
    }
    const paths = [...new Set(pick.values())];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from("applications").createSignedUrls(paths, 600);
      const urls = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
      for (const row of rows) row.thumbnail = urls.get(pick.get(row.id) ?? "") ?? null;
    }
  }
  return { rows, total: count ?? 0, page, pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)) };
}

export async function countOpenApplications(supabase: SupabaseClient) {
  const { count } = await supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "new");
  return count ?? 0;
}

export async function getApplication(supabase: SupabaseClient, id: string, permissions: PermissionSet) {
  const { data, error } = await supabase.from("applications").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const application = data as unknown as ApplicationDetail;

  const [photos, notes] = await Promise.all([
    supabase.from("application_photos").select("id,kind,storage_path,source_url,status,error,created_at").eq("application_id", id).order("created_at"),
    supabase.from("application_notes").select("id,body,created_at,author_id").eq("application_id", id).order("created_at", { ascending: false }),
  ]);
  const photoRows = (photos.data ?? []) as { id: string; kind: string; storage_path: string | null; source_url: string | null; status: string; error: string | null }[];
  const stored = photoRows.filter((photo) => photo.storage_path).map((photo) => photo.storage_path as string);
  const signed = stored.length ? (await supabase.storage.from("applications").createSignedUrls(stored, 600)).data ?? [] : [];
  const urls = new Map(signed.map((item) => [item.path, item.signedUrl]));

  // Possible duplicates: other applications or existing talent with the same email/phone.
  const duplicates: { kind: "application" | "talent"; id: string; label: string }[] = [];
  const email = application.email?.toLowerCase();
  const phoneDigits = application.phone?.replace(/\D/g, "").slice(-10);
  if (email) {
    const { data: others } = await supabase.from("applications").select("id,first_name,last_name,email,status").ilike("email", email).neq("id", id).limit(5);
    for (const other of (others ?? []) as ApplicationListRow[]) duplicates.push({ kind: "application", id: other.id, label: `${applicantName(other)} · ${STATUS_LABELS[other.status]}` });
  }
  if (permissions.has("talent.private.view") && (email || phoneDigits)) {
    const conditions = [email ? `email.ilike.${email}` : null, phoneDigits && phoneDigits.length >= 7 ? `mobile.ilike.%${phoneDigits.slice(-7)}%` : null].filter(Boolean).join(",");
    const { data: talent } = await supabase.from("talent_private_details").select("talent_id,talent:talent_id(display_name,publication_status)").or(conditions).limit(5);
    for (const row of (talent ?? []) as unknown as { talent_id: string; talent: { display_name: string; publication_status: string } | null }[]) {
      if (row.talent_id !== application.converted_talent_id) duplicates.push({ kind: "talent", id: row.talent_id, label: `${row.talent?.display_name ?? "Talent"} · ${row.talent?.publication_status ?? ""}` });
    }
  }

  return {
    application,
    photos: photoRows.map((photo) => ({ ...photo, url: photo.storage_path ? urls.get(photo.storage_path) ?? null : null })),
    notes: await withAuthors(supabase, (notes.data ?? []) as { id: string; body: string; created_at: string; author_id: string | null }[]),
    duplicates,
  };
}

// Notes reference auth.users, which the API cannot join, so names come from profiles.
async function withAuthors(supabase: SupabaseClient, notes: { id: string; body: string; created_at: string; author_id: string | null }[]) {
  const ids = [...new Set(notes.map((note) => note.author_id).filter(Boolean))] as string[];
  const { data } = ids.length ? await supabase.from("profiles").select("id,full_name,email").in("id", ids) : { data: [] };
  const names = new Map(((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((row) => [row.id, row.full_name || row.email || "Staff"]));
  return notes.map((note) => ({ ...note, author: note.author_id ? names.get(note.author_id) ?? "Staff" : "GHL integration" }));
}
