import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { formatDate } from "@/lib/format";
import { log } from "@/lib/log";
import { CrmBadges } from "@/features/ghl/components/CrmBadges";
import { CreateTalentButton, SyncContactButton } from "@/features/ghl/components/GhlActions";
import { GhlNav } from "@/features/ghl/components/GhlNav";
import { CRM_STATUSES, CRM_STATUS_LABELS } from "@/features/ghl/status";

export const metadata = { title: "GHL contacts" };

const PAGE_SIZE = 50;
type Search = { q?: string; status?: string; linked?: string; page?: string };
type Row = { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; crm_status: string | null; programs: string[]; talent_id: string | null; source_updated_at: string | null; removed_at: string | null };

// Every mirrored GHL contact, including people who are not (yet) talent.
export default async function GhlContactsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const context = await requirePage("integrations.view");
  if (!context) return <UnauthorizedState />;
  const search = await searchParams;
  const { supabase, permissions } = context;
  const canCreate = permissions.has("integrations.manage") && permissions.has("talent.create") && permissions.has("talent.private.edit");
  const canSync = permissions.has("integrations.manage");
  const page = Math.max(1, Number(search.page) || 1);

  let query = supabase.from("ghl_contacts").select("id,first_name,last_name,email,phone,crm_status,programs,talent_id,source_updated_at,removed_at", { count: "exact" });
  const term = search.q?.replace(/[,()%*\\]/g, " ").trim().slice(0, 80);
  if (term) query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  if (search.status === "none") query = query.is("crm_status", null);
  else if (search.status && (CRM_STATUSES as readonly string[]).includes(search.status)) query = query.eq("crm_status", search.status);
  if (search.linked === "yes") query = query.not("talent_id", "is", null);
  if (search.linked === "no") query = query.is("talent_id", null);
  const { data, count, error } = await query.order("source_updated_at", { ascending: false, nullsFirst: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) {
    log.error("ghl", "contacts list failed", error);
    return <ErrorState title="GHL contacts could not be loaded" />;
  }
  const rows = (data ?? []) as Row[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const href = (overrides: Partial<Search>) => `/dashboard/ghl/contacts?${new URLSearchParams(Object.entries({ ...search, ...overrides }).filter(([, value]) => value) as [string, string][])}`;
  const fieldClass = "mt-2 w-full rounded-md border border-[#dcdcd6] bg-white px-3 py-2.5 text-sm font-400 normal-case tracking-normal outline-none focus:border-[#a4502f]";
  const name = (row: Row) => [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || row.id;

  return <div className="space-y-6">
    <PageHeader eyebrow="GHL Sync" title="Contacts" description={`${count ?? 0} GoHighLevel contacts match. Talent records are created automatically for the statuses chosen under Mapping; use “Create talent” for anyone else.`} />
    <GhlNav active="/dashboard/ghl/contacts" />
    <form role="search" className="grid gap-3 rounded-xl border border-[#e7e7e3] bg-white p-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Search<input name="q" defaultValue={search.q ?? ""} placeholder="Name, email or phone" className={fieldClass} /></label>
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">CRM status<select name="status" defaultValue={search.status ?? ""} className={fieldClass}><option value="">Any</option>{CRM_STATUSES.map((status) => <option key={status} value={status}>{CRM_STATUS_LABELS[status]}</option>)}<option value="none">No status</option></select></label>
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Talent record<select name="linked" defaultValue={search.linked ?? ""} className={fieldClass}><option value="">Any</option><option value="yes">Has talent record</option><option value="no">No talent record</option></select></label>
      <div className="flex gap-2"><button className={buttonClass("primary")}>Filter</button><Link href="/dashboard/ghl/contacts" className={buttonClass("ghost")}>Reset</Link></div>
    </form>
    <DataTable<Row>
      rows={rows}
      rowKey={(row) => row.id}
      caption="GHL contacts"
      empty={{ title: "No contacts", body: term || search.status || search.linked ? "Try different filters." : "Run a sync from the Overview to mirror GHL contacts." }}
      columns={[
        { key: "name", header: "Contact", cell: (row) => <div><span className="font-700">{name(row)}</span><span className="block text-[11px] text-[#6b6d66]">{[row.email, row.phone].filter(Boolean).join(" · ")}{row.removed_at ? " · deleted in GHL" : ""}</span></div> },
        { key: "status", header: "CRM status · program", cell: (row) => <CrmBadges status={row.crm_status} programs={row.programs} /> },
        { key: "talent", header: "Talent", cell: (row) => row.talent_id ? <Link className="text-xs font-700 text-[#a4502f] hover:underline" href={`/dashboard/talent/${row.talent_id}?tab=crm`}>Open talent</Link> : canCreate && !row.removed_at ? <CreateTalentButton contactId={row.id} name={name(row)} /> : null },
        { key: "updated", header: "Updated in GHL", className: "whitespace-nowrap text-xs text-[#6b6d66]", cell: (row) => formatDate(row.source_updated_at) },
        { key: "sync", header: "", cell: (row) => canSync && !row.removed_at ? <SyncContactButton contactId={row.id} label="Sync" /> : null },
      ]}
    />
    {pages > 1 && <nav aria-label="Pagination" className="flex items-center justify-between text-xs text-[#6b6d66]">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 && <Link className={buttonClass("secondary", "sm")} href={href({ page: String(page - 1) })}>Previous</Link>}
        {page < pages && <Link className={buttonClass("secondary", "sm")} href={href({ page: String(page + 1) })}>Next</Link>}
      </div>
    </nav>}
  </div>;
}
