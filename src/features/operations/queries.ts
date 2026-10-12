import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";
import type { Conflict } from "./bookings";
import { findConflicts } from "./bookings";

// Reads for the operations screens, always as the signed-in user (RLS applies).
const clean = (value: string | undefined, max = 80) => (value ?? "").replace(/[,()%*\\:]/g, " ").trim().slice(0, max);
const one = <T,>(value: T | T[] | null | undefined) => (Array.isArray(value) ? value[0] ?? null : value ?? null);

export type CompanyRow = { id: string; name: string; kind: string; email: string | null; phone: string | null; city: string | null; is_active: boolean; website: string | null };
export type BookingRow = {
  id: string; reference: string; title: string; booking_type: string; status: string; start_at: string; end_at: string; all_day: boolean; location: string | null;
  company: { id: string; name: string } | null; talent: { id: string; display_name: string }[];
};

export async function listCompanies(supabase: SupabaseClient, filters: { q?: string; kind?: string; inactive?: boolean }) {
  let query = supabase.from("companies").select("id,name,kind,email,phone,city,is_active,website").order("name").limit(300);
  const q = clean(filters.q);
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,city.ilike.%${q}%`);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (!filters.inactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return data as CompanyRow[];
}

export async function getCompany(supabase: SupabaseClient, id: string) {
  const [company, contacts, bookings] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).maybeSingle(),
    supabase.from("company_contacts").select("id,name,title,email,phone,notes,is_primary").eq("company_id", id).order("is_primary", { ascending: false }).order("name"),
    listBookings(supabase, { company: id, when: "all" }),
  ]);
  if (company.error) throw company.error;
  if (!company.data) return null;
  return { company: company.data as CompanyRow & Record<string, string | null>, contacts: (contacts.data ?? []) as { id: string; name: string; title: string | null; email: string | null; phone: string | null; notes: string | null; is_primary: boolean }[], bookings: bookings.rows };
}

export async function listContacts(supabase: SupabaseClient, q?: string) {
  let query = supabase.from("company_contacts").select("id,name,title,email,phone,is_primary,company:company_id(id,name)").order("name").limit(300);
  const term = clean(q);
  if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,title.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, company: one(row.company as { id: string; name: string } | { id: string; name: string }[] | null) })) as { id: string; name: string; title: string | null; email: string | null; phone: string | null; is_primary: boolean; company: { id: string; name: string } | null }[];
}

const BOOKING_COLUMNS = "id,reference,title,booking_type,status,start_at,end_at,all_day,location,company:company_id(id,name),booking_talent(talent:talent_id(id,display_name))";

function toBookingRow(row: Record<string, unknown>): BookingRow {
  const talent = ((row.booking_talent as { talent: unknown }[] | null) ?? []).map((item) => one(item.talent as { id: string; display_name: string } | null)).filter(Boolean) as { id: string; display_name: string }[];
  return { ...(row as unknown as BookingRow), company: one(row.company as { id: string; name: string } | null), talent };
}

export const BOOKINGS_PAGE_SIZE = 40;

export async function listBookings(supabase: SupabaseClient, filters: { status?: string; when?: "upcoming" | "past" | "all"; company?: string; talent?: string; q?: string; page?: number }) {
  const page = Math.max(1, filters.page ?? 1);
  const now = new Date().toISOString();
  let query = supabase.from("bookings").select(filters.talent ? BOOKING_COLUMNS.replace("booking_talent(", "booking_talent!inner(talent_id,") : BOOKING_COLUMNS, { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.company) query = query.eq("company_id", filters.company);
  if (filters.talent) query = query.eq("booking_talent.talent_id", filters.talent);
  const q = clean(filters.q);
  if (q) query = query.or(`title.ilike.%${q}%,reference.ilike.%${q}%,location.ilike.%${q}%`);
  const when = filters.when ?? "upcoming";
  if (when === "upcoming") query = query.gte("end_at", now).order("start_at");
  else if (when === "past") query = query.lt("end_at", now).order("start_at", { ascending: false });
  else query = query.order("start_at", { ascending: false });
  const { data, count, error } = await query.range((page - 1) * BOOKINGS_PAGE_SIZE, page * BOOKINGS_PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: (data ?? []).map((row) => toBookingRow(row as unknown as Record<string, unknown>)), total: count ?? 0, page, pageCount: Math.max(1, Math.ceil((count ?? 0) / BOOKINGS_PAGE_SIZE)) };
}

export type BookingDetail = {
  booking: Record<string, unknown> & { id: string; reference: string; title: string; status: string; start_at: string; end_at: string; company_id: string | null; contact_id: string | null };
  talent: { id: string; display_name: string }[];
  company: { id: string; name: string } | null;
  financials: Record<string, unknown> | null;
  talentFees: { talent_id: string; fee: string | null; paid_to_talent_on: string | null }[];
  conflicts: Conflict[];
};

export async function getBooking(supabase: SupabaseClient, id: string, permissions: PermissionSet): Promise<BookingDetail | null> {
  const { data, error } = await supabase.from("bookings").select("*, company:company_id(id,name), booking_talent(talent:talent_id(id,display_name))").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const talent = toBookingRow(data as Record<string, unknown>).talent;
  const finance = permissions.has("finance.view");
  const [financials, fees, conflicts] = await Promise.all([
    finance ? supabase.from("booking_financials").select("*").eq("booking_id", id).maybeSingle().then((r) => r.data) : null,
    finance ? supabase.from("booking_talent_fees").select("talent_id,fee,paid_to_talent_on").eq("booking_id", id).then((r) => r.data ?? []) : [],
    ["option", "confirmed"].includes(data.status) ? findConflicts(supabase, talent.map((item) => item.id), data.start_at, data.end_at, id).catch(() => []) : [],
  ]);
  const { booking_talent: _unused, company, ...booking } = data as Record<string, unknown>;
  void _unused;
  return { booking: booking as BookingDetail["booking"], talent, company: one(company as { id: string; name: string } | null), financials: financials as Record<string, unknown> | null, talentFees: fees as BookingDetail["talentFees"], conflicts };
}

export type CalendarItem = { id: string; kind: "booking" | "appointment"; title: string; status: string; start_at: string; end_at: string; href: string; talent: string[] };

export async function calendarItems(supabase: SupabaseClient, from: Date, to: Date, talentId?: string): Promise<CalendarItem[]> {
  let bookings = supabase.from("bookings").select(talentId ? BOOKING_COLUMNS.replace("booking_talent(", "booking_talent!inner(talent_id,") : BOOKING_COLUMNS)
    .lt("start_at", to.toISOString()).gte("end_at", from.toISOString()).neq("status", "cancelled").order("start_at").limit(1000);
  if (talentId) bookings = bookings.eq("booking_talent.talent_id", talentId);
  let appointments = supabase.from("talent_appointments").select("id,event_type,client,status,start_at,end_at,booking_id,talent:talent_id(id,display_name)")
    .eq("cancelled", false).is("booking_id", null).lt("start_at", to.toISOString()).gte("start_at", new Date(from.getTime() - 86400000).toISOString()).order("start_at").limit(1000);
  if (talentId) appointments = appointments.eq("talent_id", talentId);
  const [b, a] = await Promise.all([bookings, appointments]);
  if (b.error) throw b.error;
  if (a.error) throw a.error;
  return [
    ...(b.data ?? []).map((row) => toBookingRow(row as unknown as Record<string, unknown>)).map((row) => ({
      id: row.id, kind: "booking" as const, title: `${row.reference} · ${row.title}`, status: row.status, start_at: row.start_at, end_at: row.end_at, href: `/dashboard/bookings/${row.id}`, talent: row.talent.map((item) => item.display_name),
    })),
    ...(a.data ?? []).map((row) => {
      const talent = one(row.talent as unknown as { id: string; display_name: string } | null);
      return { id: row.id, kind: "appointment" as const, title: [row.event_type || "Appointment", row.client].filter(Boolean).join(" · "), status: row.status, start_at: row.start_at, end_at: row.end_at ?? row.start_at, href: talent ? `/dashboard/talent/${talent.id}?tab=appointments` : "#", talent: talent ? [talent.display_name] : [] };
    }),
  ].sort((x, y) => x.start_at.localeCompare(y.start_at));
}

export type TaskRow = { id: string; title: string; notes: string | null; status: "open" | "done"; priority: "low" | "normal" | "high"; due_on: string | null; assignee_id: string | null; related_type: string | null; related_id: string | null; completed_at: string | null };

export async function listTasks(supabase: SupabaseClient, filters: { mine?: string; status?: string }) {
  let query = supabase.from("tasks").select("id,title,notes,status,priority,due_on,assignee_id,related_type,related_id,completed_at").limit(300);
  if (filters.mine) query = query.eq("assignee_id", filters.mine);
  query = filters.status === "done" ? query.eq("status", "done").order("completed_at", { ascending: false }) : query.eq("status", "open").order("due_on", { ascending: true, nullsFirst: false }).order("created_at");
  const { data, error } = await query;
  if (error) throw error;
  return data as TaskRow[];
}

// Active team members (for assignees and names).
export async function teamMembers(supabase: SupabaseClient) {
  const { data } = await supabase.from("agency_members").select("user_id,full_name,email,role").eq("status", "active").not("user_id", "is", null).neq("role", "talent").order("full_name");
  return ((data ?? []) as { user_id: string; full_name: string | null; email: string; role: string }[]).map((member) => ({ id: member.user_id, name: member.full_name || member.email }));
}

export async function talentOptions(supabase: SupabaseClient) {
  const { data } = await supabase.from("talent").select("id,display_name").neq("publication_status", "archived").order("display_name").limit(3000);
  return (data ?? []) as { id: string; display_name: string }[];
}

export async function companyOptions(supabase: SupabaseClient) {
  const [companies, contacts] = await Promise.all([
    supabase.from("companies").select("id,name").eq("is_active", true).order("name").limit(1000),
    supabase.from("company_contacts").select("id,name,company_id").order("name").limit(3000),
  ]);
  return { companies: (companies.data ?? []) as { id: string; name: string }[], contacts: (contacts.data ?? []) as { id: string; name: string; company_id: string }[] };
}

export type FinanceRow = BookingRow & { financials: { fee_total: string | null; currency: string; commission_pct: string | null; expenses: string | null; invoice_status: string; invoice_number: string | null; invoiced_on: string | null; paid_on: string | null } | null };

export async function financeRows(supabase: SupabaseClient, filters: { invoice?: string; from?: string; to?: string }) {
  let query = supabase.from("bookings").select(`${BOOKING_COLUMNS},booking_financials(fee_total,currency,commission_pct,expenses,invoice_status,invoice_number,invoiced_on,paid_on)`)
    .in("status", ["confirmed", "completed"]).order("start_at", { ascending: false }).limit(1000);
  if (filters.from) query = query.gte("start_at", filters.from);
  if (filters.to) query = query.lte("start_at", `${filters.to}T23:59:59Z`);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []).map((row) => ({ ...toBookingRow(row as Record<string, unknown>), financials: one((row as Record<string, unknown>).booking_financials as FinanceRow["financials"] | FinanceRow["financials"][] | null) })) as FinanceRow[];
  return filters.invoice ? rows.filter((row) => (row.financials?.invoice_status ?? "not_invoiced") === filters.invoice) : rows;
}
