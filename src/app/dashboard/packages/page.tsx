import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { formatDate } from "@/lib/format";
import { log } from "@/lib/log";
import { NewPackageButton } from "@/features/packages/NewPackageButton";
import { linkState } from "@/features/packages/share-state";

export const metadata = { title: "Packages" };

type Row = { id: string; title: string; created_at: string; expires_at: string | null; revoked_at: string | null; shared_at: string | null; view_count: number; company: { name: string } | { name: string }[] | null; package_items: { count: number }[] };

export default async function PackagesPage() {
  const context = await requirePage("packages.manage");
  if (!context) return <UnauthorizedState />;
  const { data, error } = await context.supabase.from("packages").select("id,title,created_at,expires_at,revoked_at,shared_at,view_count,company:company_id(name),package_items(count)").order("created_at", { ascending: false }).limit(200);
  if (error) {
    log.error("packages", "list failed", error);
    return <ErrorState title="Packages could not be loaded" />;
  }
  return <div className="space-y-6">
    <PageHeader eyebrow="Relationships" title="Packages" description="Curated talent selections shared with clients by private, expiring links." actions={<NewPackageButton />} />
    <DataTable<Row> rows={data as unknown as Row[]} rowKey={(row) => row.id} caption="Packages"
      empty={{ title: "No packages yet", body: "Create a package, add talent, and send the client a link." }}
      columns={[
        { key: "title", header: "Package", cell: (row) => { const company = Array.isArray(row.company) ? row.company[0] : row.company; return <Link href={`/dashboard/packages/${row.id}`} className="block"><span className="font-700 hover:text-[#a4502f]">{row.title}</span><span className="block text-[11px] text-[#6b6d66]">{company?.name ?? "No client"} · created {formatDate(row.created_at)}</span></Link>; } },
        { key: "talent", header: "Talent", className: "text-xs tabular-nums", cell: (row) => row.package_items[0]?.count ?? 0 },
        { key: "link", header: "Link", cell: (row) => { const state = linkState(row); return state === "revoked" ? <Badge tone="internal">Revoked</Badge> : state === "none" ? <Badge tone="draft">Not shared</Badge> : state === "expired" ? <Badge tone="inactive">Expired</Badge> : <Badge tone="public">Active</Badge>; } },
        { key: "views", header: "Views", className: "text-xs tabular-nums", cell: (row) => row.view_count },
      ]} />
  </div>;
}
