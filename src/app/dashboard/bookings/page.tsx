import Link from "next/link";
import { Plus } from "lucide-react";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { BookingStatus, bookingWhen } from "@/features/operations/components/BookingList";
import { listBookings, type BookingRow } from "@/features/operations/queries";
import { BOOKING_STATUSES, LABELS } from "@/features/operations/schemas";

export const metadata = { title: "Bookings" };

type Search = { status?: string; when?: string; q?: string; page?: string; talent?: string };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const context = await requirePage("operations.view");
  if (!context) return <UnauthorizedState />;
  const search = await searchParams;
  const when = (["upcoming", "past", "all"] as const).find((value) => value === search.when) ?? "upcoming";
  let result: Awaited<ReturnType<typeof listBookings>>;
  try {
    result = await listBookings(context.supabase, {
      status: BOOKING_STATUSES.includes(search.status as never) ? search.status : undefined, when, q: search.q, page: Number(search.page) || 1,
      talent: search.talent && /^[0-9a-f-]{36}$/i.test(search.talent) ? search.talent : undefined,
    });
  } catch (error) {
    log.error("operations", "bookings failed", error);
    return <ErrorState title="Bookings could not be loaded" />;
  }
  const href = (overrides: Partial<Search>) => {
    const params = new URLSearchParams(Object.entries({ ...search, ...overrides }).filter(([, value]) => value) as [string, string][]);
    return `/dashboard/bookings${params.size ? `?${params}` : ""}`;
  };
  const fieldClass = "w-full rounded-md border border-[#dcdcd6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#a4502f]";

  return <div className="space-y-6">
    <PageHeader eyebrow="Operations" title="Bookings" description="Options, confirmed jobs and their history."
      actions={context.permissions.has("operations.manage") ? <ButtonLink href="/dashboard/bookings/new" icon={<Plus size={14} />}>New booking</ButtonLink> : null} />
    <nav aria-label="Time range" className="flex flex-wrap gap-1.5">
      {(["upcoming", "past", "all"] as const).map((value) => <Link key={value} href={href({ when: value === "upcoming" ? undefined : value, page: undefined })} aria-current={when === value ? "page" : undefined}
        className={`rounded-full px-3 py-1.5 text-[10px] font-800 uppercase tracking-[.12em] ${when === value ? "bg-[#20211f] text-white" : "bg-white text-[#5f615b] ring-1 ring-[#e7e7e3] hover:ring-[#20211f]"}`}>{value === "upcoming" ? "Upcoming" : value === "past" ? "Past" : "All"}</Link>)}
    </nav>
    <form role="search" className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto]">
      {search.when && <input type="hidden" name="when" value={search.when} />}
      <label className="sr-only" htmlFor="bookings-q">Search bookings</label>
      <input id="bookings-q" name="q" defaultValue={search.q ?? ""} placeholder="Title, reference or location" className={fieldClass} />
      <label className="sr-only" htmlFor="bookings-status">Status</label>
      <select id="bookings-status" name="status" defaultValue={search.status ?? ""} className={fieldClass}><option value="">Any status</option>{BOOKING_STATUSES.map((status) => <option key={status} value={status}>{LABELS.status[status]}</option>)}</select>
      <button className={buttonClass("primary")}>Filter</button>
    </form>
    <DataTable<BookingRow> rows={result.rows} rowKey={(row) => row.id} caption="Bookings"
      empty={{ title: "No bookings found", body: when === "upcoming" ? "Nothing coming up. Create a booking or check past bookings." : "Try different filters." }}
      columns={[
        { key: "title", header: "Booking", cell: (row) => <Link href={`/dashboard/bookings/${row.id}`} className="block"><span className="font-700 hover:text-[#a4502f]">{row.title}</span><span className="block text-[11px] text-[#6b6d66]">{row.reference} · {LABELS.booking[row.booking_type as keyof typeof LABELS.booking] ?? row.booking_type}</span></Link> },
        { key: "when", header: "When", className: "text-xs", cell: (row) => bookingWhen(row) },
        { key: "talent", header: "Talent", cell: (row) => <span className="text-xs text-[#5f615b]">{row.talent.map((item) => item.display_name).join(", ") || "—"}</span> },
        { key: "client", header: "Client", cell: (row) => row.company ? <Link href={`/dashboard/companies/${row.company.id}`} className="text-xs hover:text-[#a4502f]">{row.company.name}</Link> : <span className="text-xs text-[#717369]">—</span> },
        { key: "status", header: "Status", cell: (row) => <BookingStatus status={row.status} /> },
      ]} />
    {result.pageCount > 1 && <nav aria-label="Pagination" className="flex items-center justify-between text-xs text-[#6b6d66]">
      <span>Page {result.page} of {result.pageCount}</span>
      <div className="flex gap-2">
        {result.page > 1 && <Link className={buttonClass("secondary", "sm")} href={href({ page: String(result.page - 1) })}>Previous</Link>}
        {result.page < result.pageCount && <Link className={buttonClass("secondary", "sm")} href={href({ page: String(result.page + 1) })}>Next</Link>}
      </div>
    </nav>}
  </div>;
}
