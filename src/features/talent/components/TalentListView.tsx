import Link from "next/link";
import { Plus } from "lucide-react";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Thumb } from "@/components/ui/Thumb";
import { formatDate } from "@/lib/format";
import type { listTalent, loadBoards, TalentListRow } from "@/features/talent/queries";
import { CrmBadges } from "@/features/ghl/components/CrmBadges";
import { CRM_STATUSES, CRM_STATUS_LABELS } from "@/features/ghl/status";
import { talentSummary } from "@/features/talent/summary";

export type TalentSearch = { q?: string; status?: string; board?: string; program?: string; crm?: string; page?: string };

const statusOptions = [
  { value: "", label: "Active (not archived)" },
  { value: "draft", label: "Draft" },
  { value: "review", label: "In review" },
  { value: "published", label: "Published" },
  { value: "website", label: "Live on website" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "Everything" },
];

function pageHref(search: TalentSearch, page: number) {
  const params = new URLSearchParams(Object.entries({ ...search, page: String(page) }).filter(([, value]) => value) as [string, string][]);
  return `/dashboard/talent?${params}`;
}

export function TalentListView({ result, boards, programs = [], search, canCreate, canExportPrivate = false }: {
  result: Awaited<ReturnType<typeof listTalent>>; boards: Awaited<ReturnType<typeof loadBoards>>["flat"]; programs?: string[]; search: TalentSearch; canCreate: boolean; canExportPrivate?: boolean;
}) {
  const fieldClass = "mt-2 w-full rounded-md border border-[#dcdcd6] bg-white px-3 py-2.5 text-sm font-400 normal-case tracking-normal outline-none focus:border-[#a4502f]";
  return <div className="space-y-6">
    <PageHeader eyebrow="Talent" title="Roster" description={`${result.total} talent record${result.total === 1 ? "" : "s"} match these filters.`}
      actions={<div className="flex flex-wrap gap-2">
        {/* File downloads from route handlers, not page navigations. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/dashboard/talents/export" className={buttonClass("secondary")}>Export CSV</a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        {canExportPrivate && <a href="/api/dashboard/talents/export?private=1" className={buttonClass("ghost")} title="Includes date of birth, email and mobile. The export is logged.">Export with private details</a>}
        {canCreate && <ButtonLink href="/dashboard/talent/new" icon={<Plus size={14} />}>New talent</ButtonLink>}
      </div>} />

    <form className="grid gap-3 rounded-xl border border-[#e7e7e3] bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] sm:items-end" role="search">
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Search<input name="q" defaultValue={search.q ?? ""} placeholder="Name, talent ID, or location" className={fieldClass} /></label>
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Status<select name="status" defaultValue={search.status ?? ""} className={fieldClass}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Board<select name="board" defaultValue={search.board ?? ""} className={fieldClass}><option value="">All boards</option>{boards.map((board) => <option key={board.id} value={board.id}>{"— ".repeat(board.depth)}{board.name}</option>)}</select></label>
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Program<select name="program" defaultValue={search.program ?? ""} className={fieldClass}><option value="">All programs</option>{programs.map((program) => <option key={program} value={program}>{program}</option>)}</select></label>
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">CRM status<select name="crm" defaultValue={search.crm ?? ""} className={fieldClass}><option value="">Any</option>{CRM_STATUSES.map((status) => <option key={status} value={status}>{CRM_STATUS_LABELS[status]}</option>)}</select></label>
      <div className="flex gap-2"><button className={buttonClass("primary")}>Filter</button><Link href="/dashboard/talent" className={buttonClass("ghost")}>Reset</Link></div>
    </form>

    <DataTable<TalentListRow>
      rows={result.talent}
      rowKey={(row) => row.id}
      caption="Talent roster"
      empty={{ title: "No talent found", body: search.q || search.status || search.board || search.program || search.crm ? "Try different filters." : "Create the first talent record to get started." }}
      columns={[
        { key: "photo", header: "", className: "w-14", cell: (row) => <Thumb src={row.thumbnail} alt={row.display_name} /> },
        { key: "name", header: "Talent", cell: (row) => <Link href={`/dashboard/talent/${row.id}`} className="block"><span className="font-700 hover:text-[#a4502f]">{row.display_name}</span><span className="block text-[11px] text-[#6b6d66]">{talentSummary(row.location, row.gender, row.age)}</span>{row.talent_id && <span className="block text-[10px] uppercase tracking-[.08em] text-[#8a8c84]">{row.talent_id}</span>}</Link> },
        { key: "program", header: "Program (GHL)", cell: (row) => <CrmBadges status={row.crm_status} programs={row.crm_programs} /> },
        { key: "boards", header: "Boards", cell: (row) => row.boards.length ? <span className="text-xs text-[#5f615b]">{row.boards.map((board) => board.name).join(", ")}</span> : <span className="text-xs text-[#717369]">Unassigned</span> },
        { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.publication_status} /> },
        { key: "website", header: "Website", cell: (row) => row.publication_status === "published" && row.show_on_website ? <Badge tone="public">Live</Badge> : <Badge tone="private">Hidden</Badge> },
        { key: "updated", header: "Updated", className: "whitespace-nowrap text-xs text-[#6b6d66]", cell: (row) => formatDate(row.updated_at) },
      ]}
    />

    {result.pageCount > 1 && <nav aria-label="Pagination" className="flex items-center justify-between text-xs text-[#6b6d66]">
      <span>Page {result.page} of {result.pageCount}</span>
      <div className="flex gap-2">
        {result.page > 1 && <Link className={buttonClass("secondary", "sm")} href={pageHref(search, result.page - 1)}>Previous</Link>}
        {result.page < result.pageCount && <Link className={buttonClass("secondary", "sm")} href={pageHref(search, result.page + 1)}>Next</Link>}
      </div>
    </nav>}
  </div>;
}
