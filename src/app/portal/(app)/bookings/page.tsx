import { formatDateTime } from "@/lib/format";
import { requireEntitledPortal } from "@/features/portal/context";

export const metadata = { title: "Bookings" };

// Confirmed and completed bookings plus appointments. Fees and client contacts
// are never visible here (database rules).
export default async function PortalBookings() {
  const { supabase, profile } = await requireEntitledPortal();
  const now = new Date().toISOString();
  const [upcoming, past, appointments] = await Promise.all([
    supabase.from("bookings").select("id,reference,title,start_at,end_at,location,status").gte("end_at", now).order("start_at").limit(50),
    supabase.from("bookings").select("id,reference,title,start_at,end_at,location,status").lt("end_at", now).order("start_at", { ascending: false }).limit(20),
    supabase.from("talent_appointments").select("id,event_type,client,start_at,end_at,status").eq("talent_id", profile.id).eq("cancelled", false).gte("start_at", now).order("start_at").limit(30),
  ]);
  const list = (rows: { id: string; title: string; start_at: string; end_at: string; location: string | null; reference: string }[] | null, empty: string) => rows?.length
    ? <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-white">{rows.map((row) => <li key={row.id} className="px-4 py-3 text-sm"><p className="font-700">{row.title}</p><p className="text-xs text-[var(--muted)]">{formatDateTime(row.start_at)} – {formatDateTime(row.end_at)}{row.location ? ` · ${row.location}` : ""} · {row.reference}</p></li>)}</ul>
    : <p className="text-sm text-[var(--muted)]">{empty}</p>;

  return <div className="space-y-8">
    <h1 className="display text-5xl leading-none">Bookings</h1>
    <section className="space-y-3"><h2 className="text-sm font-800">Coming up</h2>{list(upcoming.data, "No confirmed bookings yet. Your agent will add them here.")}</section>
    {appointments.data && appointments.data.length > 0 && <section className="space-y-3"><h2 className="text-sm font-800">Appointments</h2>
      <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-white">{appointments.data.map((row) => <li key={row.id} className="px-4 py-3 text-sm"><p className="font-700">{[row.event_type, row.client].filter(Boolean).join(" · ") || "Appointment"}</p><p className="text-xs text-[var(--muted)]">{row.start_at ? formatDateTime(row.start_at) : ""}</p></li>)}</ul></section>}
    <section className="space-y-3"><h2 className="text-sm font-800">Past</h2>{list(past.data, "No past bookings.")}</section>
  </div>;
}
