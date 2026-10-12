import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { CompanyDialog, ContactsPanel, DeleteCompanyButton } from "@/features/operations/components/CompanyForms";
import { BookingList } from "@/features/operations/components/BookingList";
import { getCompany } from "@/features/operations/queries";
import { LABELS } from "@/features/operations/schemas";

export const metadata = { title: "Company" };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePage("operations.view");
  if (!context) return <UnauthorizedState />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let data: Awaited<ReturnType<typeof getCompany>>;
  try {
    data = await getCompany(context.supabase, id);
  } catch (error) {
    log.error("operations", "company failed", error);
    return <ErrorState title="This company could not be loaded" />;
  }
  if (!data) notFound();
  const { company, contacts, bookings } = data;
  const canManage = context.permissions.has("operations.manage");
  const details: [string, string | null][] = [
    ["Email", company.email], ["Billing email", company.billing_email as string | null], ["Phone", company.phone], ["Website", company.website],
    ["Address", [company.address_1, company.city, company.state, company.postal_code, company.country].filter(Boolean).join(", ") || null],
  ];

  return <div className="space-y-6">
    <Link href="/dashboard/companies" className="inline-flex items-center gap-2 text-xs text-[#6b6d66] hover:text-[#20211f]"><ArrowLeft size={14} aria-hidden />All companies</Link>
    <PageHeader eyebrow={LABELS.company[company.kind as keyof typeof LABELS.company] ?? "Company"} title={company.name} description={company.is_active ? undefined : "Inactive"}
      actions={canManage ? <div className="flex flex-wrap gap-2"><ButtonLink href={`/dashboard/bookings/new?company=${company.id}`} size="sm" icon={<Plus size={13} />}>New booking</ButtonLink><CompanyDialog trigger="edit" company={company} /><DeleteCompanyButton id={company.id} name={company.name} /></div> : null} />
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="min-w-0 space-y-6">
        <Card title="Details">
          <dl className="space-y-3 text-sm">{details.map(([label, value]) => <div key={label}><dt className="text-[10px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">{label}</dt><dd className="mt-0.5 break-words">{value ? (label === "Website" && /^https?:/.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer" className="underline">{value}</a> : value) : <span className="text-[#717369]">—</span>}</dd></div>)}</dl>
          {company.notes && <p className="mt-4 whitespace-pre-line border-t border-[#efefeb] pt-4 text-sm leading-6">{company.notes}</p>}
        </Card>
        <ContactsPanel companyId={company.id} contacts={contacts} canManage={canManage} />
      </div>
      <Card title={`Bookings (${bookings.length})`} className="min-w-0"><BookingList rows={bookings} empty="No bookings with this company yet." /></Card>
    </div>
  </div>;
}
