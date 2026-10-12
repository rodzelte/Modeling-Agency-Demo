import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { listContacts } from "@/features/operations/queries";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const context = await requirePage("operations.view");
  if (!context) return <UnauthorizedState />;
  const { q } = await searchParams;
  let rows: Awaited<ReturnType<typeof listContacts>>;
  try {
    rows = await listContacts(context.supabase, q);
  } catch (error) {
    log.error("operations", "contacts failed", error);
    return <ErrorState title="Contacts could not be loaded" />;
  }
  return <div className="space-y-6">
    <PageHeader eyebrow="Relationships" title="Contacts" description="People at client companies. Add or edit them on the company's page." />
    <form role="search" className="flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor="contacts-q">Search contacts</label>
      <input id="contacts-q" name="q" defaultValue={q ?? ""} placeholder="Name, email, phone or job title" className="w-full rounded-md border border-[#dcdcd6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#a4502f] sm:max-w-md" />
      <button className={buttonClass("primary")}>Search</button>
    </form>
    <DataTable rows={rows} rowKey={(row) => row.id} caption="Contacts"
      empty={{ title: "No contacts found", body: "Contacts are added from a company's page." }}
      columns={[
        { key: "name", header: "Name", cell: (row) => <span><span className="font-700">{row.name}</span>{row.title && <span className="block text-[11px] text-[#6b6d66]">{row.title}</span>}</span> },
        { key: "company", header: "Company", cell: (row) => row.company ? <Link href={`/dashboard/companies/${row.company.id}`} className="hover:text-[#a4502f]">{row.company.name}</Link> : "—" },
        { key: "email", header: "Email", cell: (row) => row.email ? <a href={`mailto:${row.email}`} className="text-xs hover:underline">{row.email}</a> : <span className="text-xs text-[#717369]">—</span> },
        { key: "phone", header: "Phone", cell: (row) => <span className="text-xs">{row.phone ?? "—"}</span> },
      ]} />
  </div>;
}
