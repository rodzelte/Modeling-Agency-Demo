import type { SupabaseClient } from "@supabase/supabase-js";
import { Card } from "@/components/ui/PageHeader";
import { formatDate, formatDateTime } from "@/lib/format";
import { CUSTOM_TARGETS, displayValue, isCustomTarget, NATIVE_TARGETS } from "../fields";
import { CrmBadges } from "./CrmBadges";
import { ConflictActions, SyncContactButton } from "./GhlActions";

// Everything GoHighLevel holds about one talent, read from the mirrored tables
// under the viewer's session (integrations.view). Empty sections are hidden and
// blank values are left out; nothing here is invented or defaulted.
type Contact = {
  id: string; email: string | null; phone: string | null; tags: string[]; source: string | null; contact_type: string | null; assigned_to: string | null;
  custom_fields: Record<string, unknown>; crm_status: string | null; crm_status_reason: string | null; programs: string[];
  source_created_at: string | null; source_updated_at: string | null; synced_at: string; full_fetched_at: string | null; removed_at: string | null;
};
type Opportunity = { id: string; name: string | null; pipeline_id: string; stage_id: string | null; status: string | null; monetary_value: number | null; source: string | null; assigned_to: string | null; source_created_at: string | null; source_updated_at: string | null; removed_at: string | null };
type History = { id: string; pipeline_id: string | null; from_stage_id: string | null; to_stage_id: string | null; from_status: string | null; to_status: string | null; changed_at: string };
type Field = { id: string; name: string; target: string | null; data_type: string | null };

const TRAINING = /training|class|session|saturday|sunday|expo|audition|convention|casting|monologue|script|intro video/i;
const ADMIN = /fee|invoice|payment|contract|w-?9|workforce|onboarding|call outcome|follow-?up|tag user|meeting|notes|billing|created|last edited/i;

export async function CrmTab({ talentId, supabase, canManage, canResolve }: { talentId: string; supabase: SupabaseClient; canManage: boolean; canResolve: boolean }) {
  const { data: contact } = await supabase.from("ghl_contacts")
    .select("id,email,phone,tags,source,contact_type,assigned_to,custom_fields,crm_status,crm_status_reason,programs,source_created_at,source_updated_at,synced_at,full_fetched_at,removed_at")
    .eq("talent_id", talentId).maybeSingle<Contact>();
  if (!contact) {
    return <Card title="Not linked to GoHighLevel">
      <p className="text-sm text-[#5f615b]">This talent has no GHL contact yet. Talent are linked automatically when their GHL status qualifies (see GHL Sync → Mapping), or from GHL Sync → Contacts with “Create talent”.</p>
    </Card>;
  }

  const [opportunities, history, pipelines, stages, fields, users, conflicts, values] = await Promise.all([
    supabase.from("ghl_opportunities").select("id,name,pipeline_id,stage_id,status,monetary_value,source,assigned_to,source_created_at,source_updated_at,removed_at").eq("contact_id", contact.id).order("source_updated_at", { ascending: false }),
    supabase.from("ghl_opportunity_history").select("id,pipeline_id,from_stage_id,to_stage_id,from_status,to_status,changed_at").eq("contact_id", contact.id).order("changed_at", { ascending: false }).limit(50),
    supabase.from("ghl_pipelines").select("id,name,badge_label"),
    supabase.from("ghl_pipeline_stages").select("id,name,normalized_status"),
    supabase.from("ghl_field_definitions").select("id,name,target,data_type").eq("object_key", "contact"),
    supabase.from("ghl_users").select("id,name"),
    supabase.from("ghl_sync_conflicts").select("id,target,dashboard_value,ghl_value,detected_at").eq("talent_id", talentId).eq("status", "open"),
    supabase.from("ghl_custom_values").select("id,name,value").is("removed_at", null).order("name"),
  ]);
  const pipelineName = new Map((pipelines.data ?? []).map((row) => [row.id, row.name as string]));
  const stageName = new Map((stages.data ?? []).map((row) => [row.id, row.name as string]));
  const userName = new Map((users.data ?? []).map((row) => [row.id, row.name as string]));
  const fieldById = new Map(((fields.data ?? []) as Field[]).map((row) => [row.id, row]));

  // Custom fields with a value, grouped for reading. Photos live in the Media tab.
  const filled = Object.entries(contact.custom_fields ?? {})
    .map(([id, value]) => ({ id, field: fieldById.get(id), text: displayValue(value) }))
    .filter((row) => row.text !== null && row.field && row.field.data_type !== "FILE_UPLOAD")
    .sort((a, b) => a.field!.name.localeCompare(b.field!.name));
  const groups = [
    { title: "Training & events", rows: filled.filter((row) => TRAINING.test(row.field!.name)) },
    { title: "Admin & onboarding", rows: filled.filter((row) => !TRAINING.test(row.field!.name) && ADMIN.test(row.field!.name)) },
    { title: "Profile details from GHL", rows: filled.filter((row) => !TRAINING.test(row.field!.name) && !ADMIN.test(row.field!.name)) },
  ].filter((group) => group.rows.length);

  const label = (target: string) => (isCustomTarget(target) ? CUSTOM_TARGETS[target].label : NATIVE_TARGETS[target as keyof typeof NATIVE_TARGETS] ?? target);
  const opportunityRows = (opportunities.data ?? []) as Opportunity[];
  const trainingValues = (values.data ?? []).filter((row) => row.value && !/company/i.test(row.name));

  return <div className="space-y-6">
    {(conflicts.data ?? []).length > 0 && <Card title="Needs a decision" description="GHL and the dashboard both changed these values since the last sync. Nothing was overwritten.">
      <ul className="divide-y divide-[#efefeb]">
        {(conflicts.data ?? []).map((conflict) => <li key={conflict.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm"><p className="font-700">{label(conflict.target)}</p>
            <p className="text-xs text-[#5f615b]">Dashboard: <strong>{conflict.dashboard_value}</strong> · GHL: <strong>{conflict.ghl_value}</strong> · {formatDate(conflict.detected_at)}</p></div>
          {canResolve && <ConflictActions id={conflict.id} />}
        </li>)}
      </ul>
    </Card>}

    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card title="CRM status" actions={canManage ? <SyncContactButton contactId={contact.id} /> : undefined}>
        <div className="space-y-3 text-sm">
          <CrmBadges status={contact.crm_status} programs={contact.programs} />
          {contact.crm_status_reason && <p className="text-xs text-[#5f615b]">From: {contact.crm_status_reason}</p>}
          {contact.removed_at && <p className="text-xs font-700 text-[#a9593d]">This contact was deleted in GHL on {formatDate(contact.removed_at)}. The talent record is kept.</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
            {([["Email", contact.email], ["Phone", contact.phone], ["Source", contact.source], ["Contact type", contact.contact_type],
              ["Assigned to", contact.assigned_to ? userName.get(contact.assigned_to) ?? null : null], ["In GHL since", formatDate(contact.source_created_at)]] as [string, string | null][])
              .filter(([, value]) => value).map(([name, value]) => <div key={name}><dt className="text-[9px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">{name}</dt><dd className="mt-1 break-words font-700">{value}</dd></div>)}
          </dl>
          {contact.tags.length > 0 && <div><p className="text-[9px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">Tags</p>
            <div className="mt-1.5 flex flex-wrap gap-1">{contact.tags.map((tag) => <span key={tag} className="rounded-full bg-[#efefeb] px-2 py-0.5 text-[11px] text-[#5f615b]">{tag}</span>)}</div></div>}
        </div>
      </Card>
      <Card title="Sync">
        <dl className="space-y-2 text-xs">
          <div><dt className="text-[#6b6d66]">GHL contact ID</dt><dd className="font-mono">{contact.id}</dd></div>
          <div><dt className="text-[#6b6d66]">Updated in GHL</dt><dd>{formatDateTime(contact.source_updated_at)}</dd></div>
          <div><dt className="text-[#6b6d66]">Last synced</dt><dd>{formatDateTime(contact.full_fetched_at ?? contact.synced_at)}</dd></div>
        </dl>
      </Card>
    </div>

    {opportunityRows.length > 0 && <Card title="Opportunities" description="Every GHL pipeline this person is in.">
      <div className="relative overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
        <thead><tr className="text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="py-2 pr-3">Pipeline</th><th className="py-2 pr-3">Stage</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Value</th><th className="py-2 pr-3">Assigned</th><th className="py-2">Updated</th></tr></thead>
        <tbody>{opportunityRows.map((row) => <tr key={row.id} className={`border-t border-[#f3f3f0] ${row.removed_at ? "opacity-50" : ""}`}>
          <td className="py-2 pr-3 font-700">{pipelineName.get(row.pipeline_id) ?? row.pipeline_id}</td>
          <td className="py-2 pr-3">{row.stage_id ? stageName.get(row.stage_id) ?? row.stage_id : ""}</td>
          <td className="py-2 pr-3 capitalize">{row.status ?? ""}{row.removed_at ? " (deleted in GHL)" : ""}</td>
          <td className="py-2 pr-3">{row.monetary_value !== null ? `$${row.monetary_value.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}</td>
          <td className="py-2 pr-3">{row.assigned_to ? userName.get(row.assigned_to) ?? "" : ""}</td>
          <td className="py-2 text-xs text-[#6b6d66]">{formatDate(row.source_updated_at)}</td>
        </tr>)}</tbody>
      </table></div>
    </Card>}

    {(history.data ?? []).length > 0 && <Card title="Pipeline history" description="Stage and status changes seen by the sync (GHL does not keep this history itself, so it starts from the first sync).">
      <ol className="space-y-2 text-xs">
        {((history.data ?? []) as History[]).map((row) => <li key={row.id} className="flex flex-wrap gap-x-2">
          <span className="text-[#6b6d66]">{formatDateTime(row.changed_at)}</span>
          <span className="font-700">{row.pipeline_id ? pipelineName.get(row.pipeline_id) : ""}</span>
          <span>{row.from_stage_id ? `${stageName.get(row.from_stage_id) ?? "?"} → ` : "Entered "}{row.to_stage_id ? stageName.get(row.to_stage_id) ?? "?" : ""}</span>
          {row.from_status !== row.to_status && <span className="capitalize text-[#5f615b]">({[row.from_status, row.to_status].filter(Boolean).join(" → ")})</span>}
        </li>)}
      </ol>
    </Card>}

    {groups.map((group) => <Card key={group.title} title={group.title}>
      <dl className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
        {group.rows.map((row) => <div key={row.id}>
          <dt className="text-[9px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">{row.field!.name}{row.field!.target ? ` → ${label(row.field!.target)}` : ""}</dt>
          <dd className="mt-1 whitespace-pre-line break-words">{row.text}</dd>
        </div>)}
      </dl>
    </Card>)}

    {trainingValues.length > 0 && <Card title="Current program details (agency-wide)" description="GHL custom values: the same for everyone, not specific to this talent.">
      <dl className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
        {trainingValues.map((row) => <div key={row.id}><dt className="text-[9px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">{row.name}</dt><dd className="mt-1">{row.value}</dd></div>)}
      </dl>
    </Card>}
  </div>;
}
