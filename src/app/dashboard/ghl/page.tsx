import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { formatDateTime } from "@/lib/format";
import { log } from "@/lib/log";
import { ghlConfigured } from "@/features/ghl/client";
import { CUSTOM_TARGETS, isCustomTarget, NATIVE_TARGETS } from "@/features/ghl/fields";
import { ConflictActions, RetryFailedButton, RunSyncButton } from "@/features/ghl/components/GhlActions";
import { GhlNav } from "@/features/ghl/components/GhlNav";

export const metadata = { title: "GHL Sync" };

type Run = { id: string; trigger: string; status: string; stats: Record<string, number>; error: string | null; started_at: string; finished_at: string | null; cursor: { phase?: string } };

// Sync health at a glance. All counts are live database counts; nothing is estimated.
export default async function GhlSyncPage() {
  const context = await requirePage("integrations.view");
  if (!context) return <UnauthorizedState />;
  const { supabase, permissions } = context;
  const canManage = permissions.has("integrations.manage");
  const canResolve = canManage && permissions.has("talent.edit") && permissions.has("talent.private.edit");
  const count = (query: PromiseLike<{ count: number | null }>) => Promise.resolve(query).then((result) => result.count ?? 0);
  const head = { count: "exact" as const, head: true };

  let data;
  try {
    const [contacts, linked, opportunities, photos, failed, dead, pending, unmappedFields, unreviewedPipelines, unmappedStages, conflicts, runs, lastWebhook, lastSuccess, failures] = await Promise.all([
      count(supabase.from("ghl_contacts").select("id", head).is("removed_at", null)),
      count(supabase.from("ghl_contacts").select("id", head).not("talent_id", "is", null)),
      count(supabase.from("ghl_opportunities").select("id", head).is("removed_at", null)),
      count(supabase.from("talent_photos").select("id", head).eq("source", "ghl")),
      count(supabase.from("ghl_sync_jobs").select("id", head).eq("status", "failed")),
      count(supabase.from("ghl_sync_jobs").select("id", head).eq("status", "dead")),
      count(supabase.from("ghl_sync_jobs").select("id", head).in("status", ["pending", "running"])),
      count(supabase.from("ghl_field_definitions").select("id", head).is("target", null).is("reviewed_at", null).is("removed_at", null)),
      count(supabase.from("ghl_pipelines").select("id", head).is("purpose", null).is("removed_at", null)),
      supabase.from("ghl_pipeline_stages").select("id,ghl_pipelines!inner(purpose)", head).is("normalized_status", null).is("removed_at", null).eq("ghl_pipelines.purpose", "talent").then((result) => result.count ?? 0),
      supabase.from("ghl_sync_conflicts").select("id,talent_id,target,dashboard_value,ghl_value,detected_at,talent:talent_id(display_name)").eq("status", "open").order("detected_at", { ascending: false }).limit(50),
      supabase.from("ghl_sync_runs").select("id,trigger,status,stats,error,started_at,finished_at,cursor").order("started_at", { ascending: false }).limit(8),
      supabase.from("ghl_webhook_events").select("received_at,event,outcome").order("received_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("ghl_sync_runs").select("finished_at").eq("status", "succeeded").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("ghl_sync_jobs").select("id,kind,external_id,status,attempts,last_error,updated_at").in("status", ["failed", "dead"]).order("updated_at", { ascending: false }).limit(25),
    ]);
    data = { contacts, linked, opportunities, photos, failed, dead, pending, unmappedFields, unreviewedPipelines, unmappedStages, conflicts, runs, lastWebhook, lastSuccess, failures };
  } catch (error) {
    log.error("ghl", "overview failed", error);
    return <ErrorState title="GHL sync status could not be loaded" />;
  }
  const connected = ghlConfigured();
  const runs = (data.runs.data ?? []) as Run[];
  const lastRun = runs[0];
  const createdRecently = runs.reduce((total, run) => total + (run.stats?.talents_linked_or_created ?? 0), 0);
  const label = (target: string) => (isCustomTarget(target) ? CUSTOM_TARGETS[target].label : NATIVE_TARGETS[target as keyof typeof NATIVE_TARGETS] ?? target);

  const tiles: [string, string | number, string?][] = [
    ["Connection", connected ? "Connected" : "Not configured", connected ? undefined : "Set GHL_API_TOKEN and GHL_LOCATION_ID on the server"],
    ["Last successful sync", data.lastSuccess.data?.finished_at ? formatDateTime(data.lastSuccess.data.finished_at) : "Never"],
    ["Last webhook", data.lastWebhook.data ? formatDateTime(data.lastWebhook.data.received_at) : "None yet", data.lastWebhook.data?.event ?? undefined],
    ["Contacts mirrored", data.contacts],
    ["Linked talent", data.linked, createdRecently ? `${createdRecently} linked or created in the last ${runs.length} runs` : undefined],
    ["Opportunities", data.opportunities],
    ["Photos from GHL", data.photos],
    ["Queued", data.pending],
    ["Failed records", data.failed + data.dead, data.dead ? `${data.dead} gave up after 8 attempts` : undefined],
  ];
  const review: [string, number, string][] = [
    ["Unmapped fields", data.unmappedFields, "/dashboard/ghl/mapping#fields"],
    ["New pipelines to review", data.unreviewedPipelines, "/dashboard/ghl/mapping#pipelines"],
    ["Unmapped talent stages", data.unmappedStages, "/dashboard/ghl/mapping#pipelines"],
    ["Sync conflicts", (data.conflicts.data ?? []).length, "#conflicts"],
  ];

  return <div className="space-y-6">
    <PageHeader eyebrow="Integrations" title="GHL Sync" description="GoHighLevel stays the CRM. Contacts, opportunities and custom fields are mirrored here automatically; qualifying models get one talent record each. Publishing to the website is always a separate, manual step."
      actions={canManage && connected ? <><RunSyncButton /><RetryFailedButton count={data.failed + data.dead} /></> : undefined} />
    <GhlNav active="/dashboard/ghl" />

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map(([name, value, hint]) => <div key={name} className="rounded-xl border border-[#e7e7e3] bg-white p-4">
        <p className="text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]">{name}</p>
        <p className="mt-1 text-xl font-700">{value}</p>
        {hint && <p className="mt-1 text-[11px] text-[#6b6d66]">{hint}</p>}
      </div>)}
    </div>

    <Card title="Needs review">
      <ul className="grid gap-2 sm:grid-cols-2">
        {review.map(([name, value, href]) => <li key={name}><Link href={href} className="flex items-center justify-between rounded-lg border border-[#efefeb] px-3 py-2 text-sm hover:border-[#20211f]">
          <span>{name}</span>{value ? <Badge tone="review">{value}</Badge> : <Badge tone="published">0</Badge>}</Link></li>)}
      </ul>
    </Card>

    <Card title="Sync conflicts" description="GHL and the dashboard changed the same value. Nothing was overwritten; choose which to keep." className="scroll-mt-6">
      <div id="conflicts" />
      {(data.conflicts.data ?? []).length ? <ul className="divide-y divide-[#efefeb]">
        {(data.conflicts.data ?? []).map((conflict) => {
          const talent = conflict.talent as unknown as { display_name: string } | null;
          return <li key={conflict.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm"><Link className="font-700 hover:text-[#a4502f]" href={`/dashboard/talent/${conflict.talent_id}?tab=crm`}>{talent?.display_name ?? "Talent"}</Link> · {label(conflict.target)}
              <p className="text-xs text-[#5f615b]">Dashboard: <strong>{conflict.dashboard_value}</strong> · GHL: <strong>{conflict.ghl_value}</strong> · {formatDateTime(conflict.detected_at)}</p></div>
            {canResolve && <ConflictActions id={conflict.id} />}
          </li>;
        })}
      </ul> : <p className="text-sm text-[#6b6d66]">No open conflicts.</p>}
    </Card>

    {(data.failures.data ?? []).length > 0 && <Card title="Failed records" description="Retried automatically with increasing delays; after 8 attempts they wait for “Retry failed”.">
      <div className="relative overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs">
        <thead><tr className="text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="py-2 pr-3">Record</th><th className="py-2 pr-3">State</th><th className="py-2 pr-3">Attempts</th><th className="py-2 pr-3">Error</th><th className="py-2">When</th></tr></thead>
        <tbody>{(data.failures.data ?? []).map((job) => <tr key={job.id} className="border-t border-[#f3f3f0] align-top">
          <td className="py-2 pr-3 font-mono">{job.kind === "push_contact" ? "push " : ""}{job.external_id}</td>
          <td className="py-2 pr-3">{job.status === "dead" ? <Badge tone="internal">Stopped</Badge> : <Badge tone="review">Retrying</Badge>}</td>
          <td className="py-2 pr-3">{job.attempts}</td>
          <td className="max-w-md break-words py-2 pr-3 text-[#5f615b]">{job.last_error}</td>
          <td className="whitespace-nowrap py-2 text-[#6b6d66]">{formatDateTime(job.updated_at)}</td>
        </tr>)}</tbody>
      </table></div>
    </Card>}

    <Card title="Recent sync runs" description={lastRun?.status === "running" ? `A run is in progress (${lastRun.cursor?.phase ?? "starting"}). The scheduled job or “Run sync now” continues it.` : "Reconciliation runs hourly and on demand; webhooks handle changes in between."}>
      {runs.length ? <div className="relative overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs">
        <thead><tr className="text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="py-2 pr-3">Started</th><th className="py-2 pr-3">By</th><th className="py-2 pr-3">Result</th><th className="py-2">Counts</th></tr></thead>
        <tbody>{runs.map((run) => <tr key={run.id} className="border-t border-[#f3f3f0] align-top">
          <td className="whitespace-nowrap py-2 pr-3">{formatDateTime(run.started_at)}</td>
          <td className="py-2 pr-3 capitalize">{run.trigger}</td>
          <td className="py-2 pr-3">{run.status === "succeeded" ? <Badge tone="published">Done</Badge> : run.status === "failed" ? <Badge tone="internal">Failed</Badge> : <Badge tone="review">Running</Badge>}{run.error && <p className="mt-1 max-w-xs break-words text-[#a9593d]">{run.error}</p>}</td>
          <td className="py-2 text-[#5f615b]">{Object.entries(run.stats ?? {}).filter(([, value]) => value).map(([key, value]) => `${key.replaceAll("_", " ")} ${value}`).join(" · ")}</td>
        </tr>)}</tbody>
      </table></div> : <p className="text-sm text-[#6b6d66]">No sync has run yet.</p>}
    </Card>
  </div>;
}
