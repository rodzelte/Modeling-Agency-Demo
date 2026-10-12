import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/format";
import { getSubscription, requirePortal } from "@/features/portal/context";

export const metadata = { title: "Home" };

export default async function PortalHome() {
  const { supabase, profile } = await requirePortal();
  const now = new Date().toISOString();
  const [bookings, requests, digitals] = await Promise.all([
    supabase.from("bookings").select("id,title,start_at,end_at,location,reference").gte("end_at", now).order("start_at").limit(5),
    supabase.from("talent_change_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("talent_photos").select("id", { count: "exact", head: true }).eq("uploaded_by_talent", true).eq("review_status", "pending"),
  ]);
  const card = "rounded-xl border border-[var(--line)] bg-white p-5";
  const subscription = await getSubscription();

  return <div className="space-y-8">
    {subscription && !subscription.entitled && <Link href="/portal/subscribe" className="block rounded-xl border border-[var(--accent)] bg-white p-5 hover:border-[var(--ink)]">
      <p className="text-[10px] font-800 uppercase tracking-[.14em] text-[var(--accent)]">Membership</p>
      <p className="mt-2 text-sm">Subscribe to unlock bookings, availability, digitals, documents and profile updates.</p>
    </Link>}
    <div>
      <p className="eyebrow text-[var(--accent)]">Welcome</p>
      <h1 className="display mt-2 text-5xl leading-none">Hi, {profile.first_name || profile.display_name}.</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">{profile.live_on_website ? <>Your profile is live on the website. <Link href={`/models/${profile.slug}`} className="underline">View it</Link>.</> : "Your profile is not on the website yet. Your agent will publish it when it is ready."}</p>
    </div>
    <section className={card}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-800">Upcoming bookings</h2><Link href="/portal/bookings" className="text-[10px] font-800 uppercase tracking-[.14em] text-[var(--muted)] hover:text-[var(--ink)]">All</Link></div>
      {bookings.data?.length ? <ul className="mt-3 divide-y divide-[var(--line)] text-sm">{bookings.data.map((booking) => <li key={booking.id} className="py-2.5"><p className="font-700">{booking.title}</p><p className="text-xs text-[var(--muted)]">{formatDateTime(booking.start_at)}{booking.location ? ` · ${booking.location}` : ""}</p></li>)}</ul>
        : <p className="mt-3 text-sm text-[var(--muted)]">No confirmed bookings yet.</p>}
    </section>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Link href="/portal/profile" className={`${card} hover:border-[var(--ink)]`}><p className="text-[10px] font-800 uppercase tracking-[.14em] text-[var(--muted)]">Pending changes</p><p className="mt-2 text-3xl font-700">{requests.count ?? 0}</p></Link>
      <Link href="/portal/digitals" className={`${card} hover:border-[var(--ink)]`}><p className="text-[10px] font-800 uppercase tracking-[.14em] text-[var(--muted)]">Digitals in review</p><p className="mt-2 text-3xl font-700">{digitals.count ?? 0}</p></Link>
      <Link href="/portal/availability" className={`${card} hover:border-[var(--ink)]`}><p className="text-[10px] font-800 uppercase tracking-[.14em] text-[var(--muted)]">Availability</p><p className="mt-2 text-sm">Tell us when you are away</p></Link>
    </div>
    {profile.measurements?.measured_on && <p className="text-xs text-[var(--muted)]">Measurements last updated {formatDate(profile.measurements.measured_on)}.</p>}
  </div>;
}
