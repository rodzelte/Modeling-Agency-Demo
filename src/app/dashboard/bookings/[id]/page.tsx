import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { BookingStatus } from "@/features/operations/components/BookingList";
import { BookingForm } from "@/features/operations/components/BookingFormClient";
import { FinancialsForm } from "@/features/operations/components/FinancialsForm";
import { companyOptions, getBooking, talentOptions } from "@/features/operations/queries";

export const metadata = { title: "Booking" };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePage("operations.view");
  if (!context) return <UnauthorizedState />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const canManage = context.permissions.has("operations.manage");

  let data: Awaited<ReturnType<typeof getBooking>>;
  let options: [Awaited<ReturnType<typeof talentOptions>>, Awaited<ReturnType<typeof companyOptions>>];
  try {
    [data, ...options] = await Promise.all([
      getBooking(context.supabase, id, context.permissions),
      canManage ? talentOptions(context.supabase) : Promise.resolve([]),
      canManage ? companyOptions(context.supabase) : Promise.resolve({ companies: [], contacts: [] }),
    ]) as [Awaited<ReturnType<typeof getBooking>>, Awaited<ReturnType<typeof talentOptions>>, Awaited<ReturnType<typeof companyOptions>>];
  } catch (error) {
    log.error("operations", "booking failed", error);
    return <ErrorState title="This booking could not be loaded" />;
  }
  if (!data) notFound();
  const { booking, talent, company, financials, talentFees } = data;
  const [talentList, { companies, contacts }] = options;
  // Viewers without manage rights still see the booked talent and company names.
  const talentForForm = canManage ? talentList : talent;
  const companiesForForm = canManage ? companies : company ? [company] : [];

  return <div className="space-y-6">
    <Link href="/dashboard/bookings" className="inline-flex items-center gap-2 text-xs text-[#6b6d66] hover:text-[#20211f]"><ArrowLeft size={14} aria-hidden />All bookings</Link>
    <PageHeader eyebrow={`Booking ${booking.reference}`} title={booking.title}
      actions={<div className="flex items-center gap-2"><BookingStatus status={booking.status} />
        <a href={`/api/dashboard/calendar/ics?booking=${booking.id}`} className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[10px] font-800 uppercase tracking-[.12em] text-[#5f615b] hover:bg-[#efefeb]"><CalendarPlus size={13} aria-hidden />Add to calendar</a></div>} />
    <BookingForm booking={booking as never} talentIds={talent.map((item) => item.id)} talent={talentForForm} companies={companiesForForm} contacts={contacts} canManage={canManage} />
    {context.permissions.has("finance.view") && <FinancialsForm bookingId={booking.id} financials={financials} talent={talent} talentFees={talentFees} canEdit={context.permissions.has("finance.manage")} />}
  </div>;
}
