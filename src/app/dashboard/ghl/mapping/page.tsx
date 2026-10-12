import { Card, PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { CUSTOM_TARGETS } from "@/features/ghl/fields";
import { CRM_STATUS_LABELS, isCrmStatus } from "@/features/ghl/status";
import { GhlNav } from "@/features/ghl/components/GhlNav";
import { DeleteRuleButton, FieldMappingControls, MarkReviewedButton, PipelineControls, RuleForm, SettingsForm, StageStatusSelect } from "@/features/ghl/components/MappingControls";

export const metadata = { title: "GHL mapping" };

type Pipeline = { id: string; name: string; purpose: string | null; badge_label: string | null; removed_at: string | null; first_seen_at: string };
type Stage = { id: string; pipeline_id: string; name: string; position: number; normalized_status: string | null; mapping_source: string | null; removed_at: string | null };
type Field = { id: string; object_key: string; name: string; field_key: string | null; data_type: string | null; target: string | null; ownership: string; reviewed_at: string | null; removed_at: string | null };

// Every mapping is data, edited here and audited: which pipelines describe talent,
// what each stage means, which GHL fields feed which dashboard fields, and who
// owns each value. Pipelines, stages and fields are discovered automatically.
export default async function GhlMappingPage() {
  const context = await requirePage("integrations.view");
  if (!context) return <UnauthorizedState />;
  const { supabase, permissions } = context;
  const canEdit = permissions.has("integrations.manage");

  let pipelines: Pipeline[], stages: Stage[], fields: Field[], settings: { talent_statuses: string[]; writeback_enabled: boolean } | null, rules: { id: string; kind: string; field_id: string | null; match_value: string; normalized_status: string }[], counts: Map<string, number>;
  try {
    const [p, s, f, st, r, o] = await Promise.all([
      supabase.from("ghl_pipelines").select("id,name,purpose,badge_label,removed_at,first_seen_at").order("name"),
      supabase.from("ghl_pipeline_stages").select("id,pipeline_id,name,position,normalized_status,mapping_source,removed_at").order("position"),
      supabase.from("ghl_field_definitions").select("id,object_key,name,field_key,data_type,target,ownership,reviewed_at,removed_at").order("object_key").order("name"),
      supabase.from("ghl_settings").select("talent_statuses,writeback_enabled").maybeSingle(),
      supabase.from("ghl_status_rules").select("id,kind,field_id,match_value,normalized_status").order("created_at"),
      supabase.from("ghl_opportunities").select("stage_id").is("removed_at", null).limit(20000),
    ]);
    for (const result of [p, s, f, st, r, o]) if (result.error) throw result.error;
    pipelines = (p.data ?? []) as Pipeline[];
    stages = (s.data ?? []) as Stage[];
    fields = (f.data ?? []) as Field[];
    settings = st.data;
    rules = r.data ?? [];
    counts = new Map();
    for (const row of o.data ?? []) if (row.stage_id) counts.set(row.stage_id, (counts.get(row.stage_id) ?? 0) + 1);
  } catch (error) {
    log.error("ghl", "mapping page failed", error);
    return <ErrorState title="GHL mappings could not be loaded" />;
  }

  const targets = Object.entries(CUSTOM_TARGETS).map(([value, info]) => ({ value, label: info.label }));
  const fieldName = new Map(fields.map((field) => [field.id, field.name]));
  const contactFields = fields.filter((field) => field.object_key === "contact" && !field.removed_at);
  const otherFields = fields.filter((field) => field.object_key !== "contact" && !field.removed_at);
  const unreviewed = contactFields.filter((field) => !field.target && !field.reviewed_at).map((field) => field.id);

  return <div className="space-y-6">
    <PageHeader eyebrow="GHL Sync" title="Mapping" description="How GoHighLevel data becomes dashboard data. Changes apply on the next sync (Run sync now to apply them immediately)." />
    <GhlNav active="/dashboard/ghl/mapping" />

    {settings && <Card title="Talent records and write-back">
      <SettingsForm statuses={settings.talent_statuses} writeback={settings.writeback_enabled} canEdit={canEdit} />
    </Card>}

    <section id="pipelines" className="scroll-mt-6 space-y-4">
      <h2 className="text-sm font-800">Pipelines and stages</h2>
      {!pipelines.length && <p className="text-sm text-[#6b6d66]">No pipelines discovered yet. Run a sync.</p>}
      {pipelines.map((pipeline) => {
        const own = stages.filter((stage) => stage.pipeline_id === pipeline.id);
        return <Card key={pipeline.id} title={pipeline.name} description={pipeline.removed_at ? "Deleted in GHL" : pipeline.purpose ? undefined : "New pipeline: choose its purpose. Until then it does not affect anyone's status."}
          actions={<PipelineControls id={pipeline.id} purpose={pipeline.purpose} badge={pipeline.badge_label} canEdit={canEdit} />}>
          {own.length ? <div className="relative overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm">
            <thead><tr className="text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="py-2 pr-3">GHL stage</th><th className="py-2 pr-3">Opportunities</th><th className="w-56 py-2">Means</th></tr></thead>
            <tbody>{own.map((stage) => <tr key={stage.id} className={`border-t border-[#f3f3f0] ${stage.removed_at ? "opacity-50" : ""}`}>
              <td className="py-2 pr-3">{stage.name}{stage.removed_at && " (deleted)"}{pipeline.purpose === "talent" && !stage.normalized_status && !stage.removed_at && <> <Badge tone="review">Unmapped</Badge></>}</td>
              <td className="py-2 pr-3 text-xs text-[#6b6d66]">{counts.get(stage.id) ?? 0}</td>
              <td className="py-2">{pipeline.purpose === "talent" ? <StageStatusSelect id={stage.id} value={stage.normalized_status} canEdit={canEdit} /> : <span className="text-xs text-[#717369]">Not used for talent status</span>}</td>
            </tr>)}</tbody>
          </table></div> : <p className="text-xs text-[#717369]">No stages.</p>}
        </Card>;
      })}
    </section>

    <Card title="Extra status rules" description="Optional: derive a status from a tag or a contact field value as well as from pipeline stages. The strongest live status wins.">
      {rules.length > 0 && <ul className="mb-4 divide-y divide-[#efefeb] text-sm">
        {rules.map((rule) => <li key={rule.id} className="flex items-center justify-between py-2">
          <span>{rule.kind === "tag" ? "Tag" : fieldName.get(rule.field_id ?? "") ?? "Field"} is “{rule.match_value}” → <strong>{isCrmStatus(rule.normalized_status) ? CRM_STATUS_LABELS[rule.normalized_status] : rule.normalized_status}</strong></span>
          {canEdit && <DeleteRuleButton id={rule.id} />}
        </li>)}
      </ul>}
      {canEdit ? <RuleForm fields={contactFields.filter((field) => ["SINGLE_OPTIONS", "MULTIPLE_OPTIONS", "RADIO", "CHECKBOX", "TEXT"].includes(field.data_type ?? "")).map((field) => ({ id: field.id, name: field.name }))} />
        : !rules.length && <p className="text-sm text-[#6b6d66]">No extra rules.</p>}
    </Card>

    <section id="fields" className="scroll-mt-6">
      <Card title={`Contact fields (${contactFields.length})`} description="Every GHL contact field is kept as CRM data (shown on the talent's CRM tab). Map a field to put its value into the talent profile; “Both ways” lets dashboard edits update GHL when write-back is on."
        actions={canEdit && unreviewed.length ? <MarkReviewedButton ids={unreviewed} /> : undefined}>
        <div className="relative overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
          <thead><tr className="text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="py-2 pr-3">GHL field</th><th className="py-2 pr-3">Type</th><th className="w-[420px] py-2">Dashboard field · source of truth</th></tr></thead>
          <tbody>{contactFields.map((field) => <tr key={field.id} className="border-t border-[#f3f3f0] align-top">
            <td className="py-2 pr-3"><span className="font-700">{field.name}</span>{!field.target && !field.reviewed_at && <> <Badge tone="review">New</Badge></>}<span className="block font-mono text-[10px] text-[#717369]">{field.field_key}</span></td>
            <td className="py-2 pr-3 text-xs text-[#6b6d66]">{field.data_type}</td>
            <td className="py-2"><FieldMappingControls id={field.id} target={field.target} ownership={field.ownership} targets={targets} canEdit={canEdit} /></td>
          </tr>)}</tbody>
        </table></div>
      </Card>
    </section>

    {otherFields.length > 0 && <Card title={`Other GHL objects (${otherFields.length} fields)`} description="Business, Company Contact and Contact Person fields are discovered and listed for reference; they describe clients, not talent, so they are not mapped to talent profiles.">
      <ul className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {otherFields.map((field) => <li key={field.id}><span className="text-[#6b6d66]">{field.object_key.replace("custom_objects.", "")}</span> · {field.name}</li>)}
      </ul>
    </Card>}
  </div>;
}
