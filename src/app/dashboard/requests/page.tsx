import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { formatDateTime } from "@/lib/format";
import { log } from "@/lib/log";
import { ChangeRequestList, type ChangeRequest } from "@/features/portal/components/StaffPortalPanels";

export const metadata = { title: "Talent requests" };

// Everything waiting on staff from the talent portal: change requests and digitals.
export default async function RequestsPage() {
  const context = await requirePage("dashboard.access");
  if (!context) return <UnauthorizedState />;
  const { supabase, permissions } = context;
  if (!permissions.has("talent.private.view") && !permissions.has("media.manage")) return <UnauthorizedState />;

  const [requests, digitals] = await Promise.all([
    permissions.has("talent.private.view")
      ? supabase.from("talent_change_requests").select("id,talent_id,field_group,changes,message,created_at,talent:talent_id(display_name)").eq("status", "pending").order("created_at").limit(200)
      : Promise.resolve({ data: [], error: null }),
    permissions.has("media.manage")
      ? supabase.from("talent_photos").select("talent_id,created_at,talent:talent_id(display_name)").eq("review_status", "pending").is("archived_at", null).order("created_at").limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (requests.error || digitals.error) {
    log.error("portal", "requests failed", requests.error ?? digitals.error);
    return <ErrorState title="Requests could not be loaded" />;
  }
  const one = <T,>(value: T | T[] | null) => (Array.isArray(value) ? value[0] ?? null : value);
  const byTalent = new Map<string, { name: string; count: number; since: string }>();
  for (const row of (digitals.data ?? []) as { talent_id: string; created_at: string; talent: { display_name: string } | { display_name: string }[] | null }[]) {
    const entry = byTalent.get(row.talent_id) ?? { name: one(row.talent)?.display_name ?? "Talent", count: 0, since: row.created_at };
    entry.count += 1;
    byTalent.set(row.talent_id, entry);
  }
  const changeRequests = ((requests.data ?? []) as (ChangeRequest & { talent: unknown })[]).map((row) => ({ ...row, talent: one(row.talent as { display_name: string } | { display_name: string }[] | null) }));

  return <div className="space-y-6">
    <PageHeader eyebrow="Talent portal" title="Talent requests" description="Changes and digitals sent by talent through the portal. Nothing is saved or published until you approve it." />
    {permissions.has("talent.private.view") && <Card title={`Change requests (${changeRequests.length})`}><ChangeRequestList requests={changeRequests} showTalent /></Card>}
    {permissions.has("media.manage") && <Card title={`Digitals to review (${[...byTalent.values()].reduce((sum, item) => sum + item.count, 0)})`}>
      {byTalent.size ? <ul className="divide-y divide-[#f3f3f0] text-sm">{[...byTalent.entries()].map(([talentId, item]) => <li key={talentId} className="flex items-center justify-between gap-3 py-2.5">
        <Link href={`/dashboard/talent/${talentId}?tab=media`} className="font-700 hover:text-[#a4502f]">{item.name}</Link>
        <span className="text-xs text-[#6b6d66]">{item.count} new · since {formatDateTime(item.since)}</span>
      </li>)}</ul> : <p className="text-sm text-[#6b6d66]">No digitals waiting.</p>}
    </Card>}
  </div>;
}
