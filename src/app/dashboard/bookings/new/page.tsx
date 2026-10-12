import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { BookingForm } from "@/features/operations/components/BookingFormClient";
import { companyOptions, talentOptions } from "@/features/operations/queries";

export const metadata = { title: "New booking" };

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<{ talent?: string; company?: string; date?: string }> }) {
  const context = await requirePage("operations.manage");
  if (!context) return <UnauthorizedState />;
  const search = await searchParams;
  const [talent, { companies, contacts }] = await Promise.all([talentOptions(context.supabase), companyOptions(context.supabase)]);
  const day = search.date && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? search.date : null;
  // Local wall-clock times; the form (browser-only) reads them in the viewer's time zone.
  const start = day ? `${day}T09:00` : undefined;
  const end = day ? `${day}T17:00` : undefined;
  const initial = { company_id: search.company && /^[0-9a-f-]{36}$/i.test(search.company) ? search.company : null, start_at: start, end_at: end };

  return <div className="space-y-6">
    <Link href="/dashboard/bookings" className="inline-flex items-center gap-2 text-xs text-[#6b6d66] hover:text-[#20211f]"><ArrowLeft size={14} aria-hidden />All bookings</Link>
    <PageHeader eyebrow="Operations" title="New booking" description="Start as an option; confirm it once the client does." />
    <BookingForm key="new" initial={initial} talent={talent} companies={companies.map((item) => ({ id: item.id, name: item.name }))} contacts={contacts} canManage
      defaultTalent={search.talent && talent.some((item) => item.id === search.talent) ? search.talent : undefined} />
  </div>;
}
