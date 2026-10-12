import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";
import { listBookings, listTasks } from "@/features/operations/queries";

const DAY = 86400000;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

// Every figure on the dashboard home comes from a live query the viewer is
// permitted to run; widgets without permission are omitted, never estimated.
export async function loadOverview(supabase: SupabaseClient, permissions: PermissionSet, viewerId?: string) {
  const today = new Date();
  const in60 = isoDate(new Date(today.getTime() + 60 * DAY));
  const count = (query: PromiseLike<{ count: number | null }>) => Promise.resolve(query).then((result) => result.count ?? 0);
  const talentCount = () => supabase.from("talent").select("id", { count: "exact", head: true });

  const [metrics, review, recent, uploads, appointments, birthdays, expiring, activity, applications, websiteDrafts, bookings, tasks] = await Promise.all([
    permissions.has("talent.view") ? Promise.all([
      count(talentCount().neq("publication_status", "archived")),
      count(talentCount().eq("publication_status", "published").eq("show_on_website", true)),
      count(talentCount().eq("publication_status", "review")),
      count(talentCount().eq("publication_status", "draft")),
    ]).then(([active, live, inReview, drafts]) => ({ active, live, inReview, drafts })) : null,

    permissions.has("talent.view")
      ? supabase.from("talent").select("id,display_name,updated_at").eq("publication_status", "review").order("updated_at", { ascending: false }).limit(6).then((r) => r.data ?? [])
      : [],

    permissions.has("talent.view")
      ? supabase.from("talent").select("id,display_name,publication_status,updated_at").neq("publication_status", "archived").order("updated_at", { ascending: false }).limit(6).then((r) => r.data ?? [])
      : [],

    permissions.has("media.view")
      ? supabase.from("talent_photos").select("id,title,created_at,talent:talent_id(id,display_name)").is("archived_at", null).order("created_at", { ascending: false }).limit(6).then((r) => r.data ?? [])
      : [],

    permissions.has("operations.view")
      ? supabase.from("talent_appointments").select("id,event_type,client,start_at,talent:talent_id(id,display_name)").eq("cancelled", false)
        .gte("start_at", today.toISOString()).lte("start_at", new Date(today.getTime() + 14 * DAY).toISOString()).order("start_at").limit(8).then((r) => r.data ?? [])
      : [],

    permissions.has("talent.private.view")
      ? supabase.from("talent_private_details").select("date_of_birth,talent:talent_id(id,display_name,publication_status)").not("date_of_birth", "is", null).then((r) => upcomingBirthdays(r.data ?? [], today))
      : [],

    permissions.has("legal.view")
      ? supabase.from("talent_legal").select("contract_expires_on,passport_expires_on,visa_expires_on,work_permit_expires_on,talent:talent_id(id,display_name)")
        .or(`contract_expires_on.lte.${in60},passport_expires_on.lte.${in60},visa_expires_on.lte.${in60},work_permit_expires_on.lte.${in60}`)
        .then((r) => expiringDocuments(r.data ?? [], isoDate(today), in60))
      : [],

    permissions.has("audit.view")
      ? supabase.from("audit_logs").select("id,action,entity_type,entity_id,created_at,actor:actor_id(full_name,email)").order("created_at", { ascending: false }).limit(10).then((r) => r.data ?? [])
      : [],

    permissions.has("applications.view")
      ? Promise.all([
        count(supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "new")),
        supabase.from("applications").select("id,first_name,last_name,email,city,is_minor,submitted_at").eq("status", "new").order("submitted_at", { ascending: false }).limit(6).then((r) => r.data ?? []),
      ]).then(([total, latest]) => ({ total, latest: latest as { id: string; first_name: string | null; last_name: string | null; email: string | null; city: string | null; is_minor: boolean; submitted_at: string }[] }))
      : null,

    permissions.has("website.manage")
      ? supabase.from("website_pages").select("id,title,slug,status,has_unpublished_changes,updated_at").neq("status", "archived").eq("has_unpublished_changes", true)
        .order("updated_at", { ascending: false }).limit(6).then((r) => (r.data ?? []) as { id: string; title: string; slug: string; status: string; has_unpublished_changes: boolean; updated_at: string }[])
      : null,

    permissions.has("operations.view") ? listBookings(supabase, { when: "upcoming" }).then((result) => result.rows.slice(0, 8)).catch(() => []) : null,
    viewerId && permissions.has("dashboard.access") ? listTasks(supabase, { mine: viewerId, status: "open" }).then((rows) => rows.slice(0, 8)).catch(() => []) : null,
  ]);

  return { metrics, review, recent, uploads, appointments, birthdays, expiring, activity, applications, websiteDrafts, bookings, tasks };
}

type TalentRef = { id: string; display_name: string; publication_status?: string } | null;
const ref = (value: unknown) => (Array.isArray(value) ? value[0] : value) as TalentRef;

function upcomingBirthdays(rows: { date_of_birth: string; talent: unknown }[], today: Date) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return rows.flatMap((row) => {
    const talent = ref(row.talent);
    if (!talent || talent.publication_status === "archived") return [];
    const [, month, day] = row.date_of_birth.split("-").map(Number);
    let next = new Date(start.getFullYear(), month - 1, day);
    if (next < start) next = new Date(start.getFullYear() + 1, month - 1, day);
    const days = Math.round((next.getTime() - start.getTime()) / DAY);
    return days <= 30 ? [{ talent, date: isoDate(next), days }] : [];
  }).sort((a, b) => a.days - b.days).slice(0, 8);
}

function expiringDocuments(rows: Record<string, unknown>[], today: string, until: string) {
  const labels: Record<string, string> = { contract_expires_on: "Contract", passport_expires_on: "Passport", visa_expires_on: "Visa", work_permit_expires_on: "Work permit" };
  return rows.flatMap((row) => Object.entries(labels).flatMap(([field, label]) => {
    const date = row[field] as string | null;
    const talent = ref(row.talent);
    return date && talent && date <= until ? [{ talent, label, date, expired: date < today }] : [];
  })).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
}
