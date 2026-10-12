"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useMutation } from "@/lib/use-mutation";
import { CRM_STATUSES, CRM_STATUS_LABELS } from "../status";

// Mapping editors. Each change saves immediately through PATCH /api/dashboard/ghl/config
// (integrations.manage; audited in the database). Read-only viewers see plain text.
const selectClass = "w-full rounded-md border border-[#dcdcd6] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#a4502f] disabled:bg-[#f6f6f3]";
const save = "/api/dashboard/ghl/config";

export function StageStatusSelect({ id, value, canEdit }: { id: string; value: string | null; canEdit: boolean }) {
  const { run, pending } = useMutation();
  return <select aria-label="Normalized status" className={selectClass} defaultValue={value ?? ""} disabled={!canEdit || pending}
    onChange={(event) => run(save, { method: "PATCH", body: { type: "stage", id, normalized_status: event.target.value || null }, success: "Stage mapping saved" })}>
    <option value="">Unmapped (ignored)</option>
    {CRM_STATUSES.map((status) => <option key={status} value={status}>{CRM_STATUS_LABELS[status]}</option>)}
  </select>;
}

export function PipelineControls({ id, purpose, badge, canEdit }: { id: string; purpose: string | null; badge: string | null; canEdit: boolean }) {
  const { run, pending } = useMutation();
  const [label, setLabel] = useState(badge ?? "");
  const [kind, setKind] = useState(purpose ?? "");
  const submit = (nextPurpose: string, nextBadge: string) => run(save, { method: "PATCH", body: { type: "pipeline", id, purpose: nextPurpose || null, badge_label: nextBadge.trim() || null }, success: "Pipeline saved" });
  return <div className="flex flex-wrap items-end gap-2">
    <label className="text-[9px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">Purpose
      <select className={`${selectClass} mt-1 w-40`} value={kind} disabled={!canEdit || pending} onChange={(event) => { setKind(event.target.value); void submit(event.target.value, label); }}>
        <option value="">Needs review</option><option value="talent">Talent pipeline</option><option value="client">Client / sales</option><option value="ignore">Ignore</option>
      </select></label>
    <label className="text-[9px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">Dashboard tag
      <input className={`${selectClass} mt-1 w-40`} value={label} maxLength={30} placeholder="e.g. Model Expo" disabled={!canEdit || pending} onChange={(event) => setLabel(event.target.value)}
        onBlur={() => { if (label.trim() !== (badge ?? "")) void submit(kind, label); }} /></label>
  </div>;
}

export function FieldMappingControls({ id, target, ownership, targets, canEdit }: { id: string; target: string | null; ownership: string; targets: { value: string; label: string }[]; canEdit: boolean }) {
  const { run, pending } = useMutation();
  const submit = (nextTarget: string, nextOwnership: string) =>
    run(save, { method: "PATCH", body: { type: "field", id, target: nextTarget || null, ownership: nextTarget ? nextOwnership : "ghl_only" }, success: "Field mapping saved" });
  return <div className="grid gap-1.5 sm:grid-cols-2">
    <select aria-label="Dashboard field" className={selectClass} defaultValue={target ?? ""} disabled={!canEdit || pending} onChange={(event) => submit(event.target.value, ownership)}>
      <option value="">Keep as CRM data only</option>
      {targets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <select aria-label="Source of truth" className={selectClass} defaultValue={ownership} disabled={!canEdit || pending || !target} onChange={(event) => submit(target ?? "", event.target.value)}>
      <option value="ghl_only">GHL only (GHL → dashboard)</option>
      <option value="bidirectional">Both ways</option>
      <option value="dashboard_only">Dashboard only (never synced)</option>
    </select>
  </div>;
}

export function MarkReviewedButton({ ids }: { ids: string[] }) {
  const { run, pending } = useMutation();
  return <Button size="sm" variant="secondary" disabled={pending || !ids.length}
    onClick={() => run(save, { method: "PATCH", body: { type: "field_reviewed", ids }, success: "Marked as reviewed (kept as CRM data)" })}>Mark all reviewed ({ids.length})</Button>;
}

export function SettingsForm({ statuses, writeback, canEdit }: { statuses: string[]; writeback: boolean; canEdit: boolean }) {
  const { run, pending } = useMutation();
  const [chosen, setChosen] = useState(new Set(statuses));
  const [push, setPush] = useState(writeback);
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void run(save, { method: "PATCH", body: { type: "settings", talent_statuses: [...chosen], writeback_enabled: push }, success: "Settings saved" }); }}>
    <fieldset disabled={!canEdit || pending}>
      <legend className="text-xs font-700">Create a talent record when the CRM status is</legend>
      <div className="mt-2 flex flex-wrap gap-3">
        {CRM_STATUSES.map((status) => <label key={status} className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={chosen.has(status)} onChange={(event) => { const next = new Set(chosen); if (event.target.checked) next.add(status); else next.delete(status); setChosen(next); }} />
          {CRM_STATUS_LABELS[status]}</label>)}
      </div>
      <label className="mt-4 flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={push} onChange={(event) => setPush(event.target.checked)} />
        <span><strong>Write dashboard edits back to GHL</strong> for fields set to “Both ways” (email, phone, measurements, social…). Off until tested on a test contact.</span>
      </label>
    </fieldset>
    {canEdit && <Button type="submit" size="sm" disabled={pending}>Save settings</Button>}
  </form>;
}

export function RuleForm({ fields }: { fields: { id: string; name: string }[] }) {
  const { run, pending } = useMutation();
  const [kind, setKind] = useState("tag");
  return <form className="grid gap-2 sm:grid-cols-[120px_1fr_1fr_140px_auto] sm:items-end" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(save, { method: "PATCH", body: { type: "rule_add", kind, field_id: kind === "tag" ? null : data.get("field_id"), match_value: data.get("match_value"), normalized_status: data.get("normalized_status") }, success: "Rule added" });
  }}>
    <select aria-label="Rule type" className={selectClass} value={kind} onChange={(event) => setKind(event.target.value)}><option value="tag">Tag is</option><option value="contact_field">Field value is</option></select>
    {kind === "contact_field" ? <select aria-label="Field" name="field_id" className={selectClass} required>{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select> : <span className="hidden sm:block" />}
    <input aria-label="Value" name="match_value" className={selectClass} required maxLength={200} placeholder={kind === "tag" ? "e.g. contract signed" : "e.g. Active Talent"} />
    <select aria-label="Then status" name="normalized_status" className={selectClass}>{CRM_STATUSES.map((status) => <option key={status} value={status}>{CRM_STATUS_LABELS[status]}</option>)}</select>
    <Button type="submit" size="sm" disabled={pending}>Add rule</Button>
  </form>;
}

export function DeleteRuleButton({ id }: { id: string }) {
  const { run, pending } = useMutation();
  return <Button size="sm" variant="ghost" aria-label="Delete rule" icon={<Trash2 size={13} />} disabled={pending}
    onClick={() => run(save, { method: "PATCH", body: { type: "rule_delete", id }, success: "Rule removed" })} />;
}
