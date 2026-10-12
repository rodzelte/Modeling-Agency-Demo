import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { CompanyDialog } from "@/features/operations/components/CompanyForms";
import { listCompanies, type CompanyRow } from "@/features/operations/queries";
import { COMPANY_KINDS, LABELS } from "@/features/operations/schemas";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; inactive?: string }> }) {
  const context = await requirePage("operations.view");
  if (!context) return <UnauthorizedState />;
  const search = await searchParams;
  let rows: CompanyRow[];
  try {
    rows = await listCompanies(context.supabase, { q: search.q, kind: COMPANY_KINDS.includes(search.kind as never) ? search.kind : undefined, inactive: search.inactive === "1" });
  } catch (error) {
    log.error("operations", "companies failed", error);
    return <ErrorState title="Companies could not be loaded" />;
  }
  const fieldClass = "w-full rounded-md border border-[#dcdcd6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#a4502f]";
  return <div className="space-y-6">
    <PageHeader eyebrow="Relationships" title="Companies" description="Clients, brands, agencies and production partners." actions={context.permissions.has("operations.manage") ? <CompanyDialog trigger="new" /> : null} />
    <form role="search" className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto_auto] sm:items-center">
      <label className="sr-only" htmlFor="companies-q">Search companies</label>
      <input id="companies-q" name="q" defaultValue={search.q ?? ""} placeholder="Name, email or city" className={fieldClass} />
      <label className="sr-only" htmlFor="companies-kind">Type</label>
      <select id="companies-kind" name="kind" defaultValue={search.kind ?? ""} className={fieldClass}><option value="">All types</option>{COMPANY_KINDS.map((kind) => <option key={kind} value={kind}>{LABELS.company[kind]}</option>)}</select>
      <label className="flex items-center gap-2 text-xs text-[#5f615b]"><input type="checkbox" name="inactive" value="1" defaultChecked={search.inactive === "1"} className="accent-[#20211f]" />Include inactive</label>
      <button className={buttonClass("primary")}>Filter</button>
    </form>
    <DataTable<CompanyRow> rows={rows} rowKey={(row) => row.id} caption="Companies"
      empty={{ title: "No companies found", body: search.q ? "Try a different search." : "Add the first client or brand." }}
      columns={[
        { key: "name", header: "Company", cell: (row) => <Link href={`/dashboard/companies/${row.id}`} className="font-700 hover:text-[#a4502f]">{row.name}</Link> },
        { key: "kind", header: "Type", cell: (row) => <span className="text-xs text-[#5f615b]">{LABELS.company[row.kind as keyof typeof LABELS.company] ?? row.kind}</span> },
        { key: "contact", header: "Contact", cell: (row) => <span className="text-xs text-[#5f615b]">{[row.email, row.phone].filter(Boolean).join(" · ") || "—"}</span> },
        { key: "city", header: "City", cell: (row) => <span className="text-xs">{row.city ?? "—"}</span> },
        { key: "status", header: "", cell: (row) => row.is_active ? null : <Badge tone="inactive">Inactive</Badge> },
      ]} />
  </div>;
}
