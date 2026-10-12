import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { Thumb } from "@/components/ui/Thumb";
import { requirePage } from "@/lib/agency-auth";
import { ageFromDob, formatDate, heightLabel } from "@/lib/format";
import { log } from "@/lib/log";
import { JOIN_URL } from "@/lib/site";
import { APPLICATION_STATUSES, STATUS_LABELS, applicantName, listApplications, type ApplicationListRow } from "@/features/applications/queries";
import { ApplicationStatusBadge } from "@/features/applications/components/ApplicationStatusBadge";
import { ConvertApprovedButton } from "@/features/applications/components/ConvertApprovedButton";

export const metadata = { title: "Applications" };

type Search = { status?: string; q?: string; page?: string };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const context = await requirePage("applications.view");
  if (!context) return <UnauthorizedState />;
  const search = await searchParams;

  const canConvert = context.permissions.has("applications.manage") && context.permissions.has("talent.create") && context.permissions.has("talent.private.edit");
  let result: Awaited<ReturnType<typeof listApplications>>;
  let approved = 0;
  try {
    const [list, approvedCount] = await Promise.all([
      listApplications(context.supabase, { status: search.status, q: search.q, page: Number(search.page) || 1 }),
      canConvert ? context.supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "approved") : Promise.resolve({ count: 0 }),
    ]);
    result = list;
    approved = approvedCount.count ?? 0;
  } catch (error) {
    log.error("applications", "list failed", error);
    return <ErrorState title="Applications could not be loaded" />;
  }

  const tabs = [{ value: "", label: "Open" }, ...APPLICATION_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })), { value: "all", label: "All" }];
  const href = (overrides: Partial<Search>) => {
    const params = new URLSearchParams(Object.entries({ ...search, ...overrides }).filter(([, value]) => value) as [string, string][]);
    const query = params.toString();
    return `/dashboard/applications${query ? `?${query}` : ""}`;
  };
  const fieldClass = "w-full rounded-md border border-[#dcdcd6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#a4502f]";

  return <div className="space-y-6">
    <PageHeader eyebrow="Join Us" title="Applications" description="Submissions from the GoHighLevel registration form. Review them here and convert approved applicants into draft talent."
      actions={<>
        {canConvert && approved > 0 && <ConvertApprovedButton count={approved} />}
        <a href={JOIN_URL} target="_blank" rel="noreferrer" className={buttonClass("secondary")}><ExternalLink size={14} aria-hidden />Open the GHL form</a>
      </>} />

    <nav aria-label="Application status" className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => {
        const active = (search.status ?? "") === tab.value;
        return <Link key={tab.value || "open"} href={href({ status: tab.value || undefined, page: undefined })} aria-current={active ? "page" : undefined}
          className={`rounded-full px-3 py-1.5 text-[10px] font-800 uppercase tracking-[.12em] ${active ? "bg-[#20211f] text-white" : "bg-white text-[#5f615b] ring-1 ring-[#e7e7e3] hover:ring-[#20211f]"}`}>{tab.label}</Link>;
      })}
    </nav>

    <form role="search" className="flex flex-col gap-2 sm:flex-row">
      {search.status && <input type="hidden" name="status" value={search.status} />}
      <label className="sr-only" htmlFor="applications-q">Search applications</label>
      <input id="applications-q" name="q" defaultValue={search.q ?? ""} placeholder="Name, email, phone, or city" className={`${fieldClass} sm:max-w-md`} />
      <button className={buttonClass("primary")}>Search</button>
    </form>

    <DataTable<ApplicationListRow>
      rows={result.rows}
      rowKey={(row) => row.id}
      caption="Applications"
      empty={{ title: "No applications here", body: search.q ? "Try a different search." : "New GHL submissions appear here automatically once the webhook is connected (docs/ghl-integration.md)." }}
      columns={[
        { key: "photo", header: "", className: "w-14", cell: (row) => <Thumb src={row.thumbnail ?? null} alt={applicantName(row)} /> },
        { key: "name", header: "Applicant", cell: (row) => <Link href={`/dashboard/applications/${row.id}`} className="block"><span className="font-700 hover:text-[#a4502f]">{applicantName(row)}</span><span className="block text-[11px] text-[#6b6d66]">{[row.email, row.phone].filter(Boolean).join(" · ")}</span></Link> },
        { key: "details", header: "Details", cell: (row) => <span className="flex flex-wrap items-center gap-1.5 text-xs text-[#5f615b]">{[[row.city, row.state].filter(Boolean).join(", "), row.date_of_birth ? `${ageFromDob(row.date_of_birth)} yrs` : null, row.height_cm ? heightLabel(row.height_cm) : null].filter(Boolean).join(" · ")}{row.is_minor && <Badge tone="review">Minor</Badge>}</span> },
        { key: "status", header: "Status", cell: (row) => <ApplicationStatusBadge status={row.status} /> },
        { key: "submitted", header: "Submitted", className: "whitespace-nowrap text-xs text-[#6b6d66]", cell: (row) => formatDate(row.submitted_at) },
      ]}
    />

    {result.pageCount > 1 && <nav aria-label="Pagination" className="flex items-center justify-between text-xs text-[#6b6d66]">
      <span>Page {result.page} of {result.pageCount} · {result.total} applications</span>
      <div className="flex gap-2">
        {result.page > 1 && <Link className={buttonClass("secondary", "sm")} href={href({ page: String(result.page - 1) })}>Previous</Link>}
        {result.page < result.pageCount && <Link className={buttonClass("secondary", "sm")} href={href({ page: String(result.page + 1) })}>Next</Link>}
      </div>
    </nav>}
  </div>;
}
