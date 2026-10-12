"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/States";
import { readForm } from "@/lib/read-form";
import { useMutation } from "@/lib/use-mutation";
import { moduleUi, type ListModule } from "../fields";
import { FieldInput, formatCell } from "./FieldInput";

type Row = Record<string, unknown> & { id: string };

// Table of a talent's records for one module, with add / edit / delete dialogs.
export function RecordList({ talentId, module, rows, canEdit, datalists = {}, defaults = {} }: {
  talentId: string; module: ListModule; rows: Row[]; canEdit: boolean; datalists?: Record<string, string[]>; defaults?: Record<string, string | boolean>;
}) {
  const ui = moduleUi[module];
  const { run, pending } = useMutation();
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const base = `/api/dashboard/talents/${talentId}/records/${module}`;
  const canUpdate = "canUpdate" in ui && ui.canUpdate;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = readForm(event.currentTarget);
    const creating = editing === "new";
    const result = await run(creating ? base : `${base}/${(editing as Row).id}`, { method: creating ? "POST" : "PATCH", body, success: creating ? `${ui.singular[0].toUpperCase()}${ui.singular.slice(1)} added` : "Changes saved" });
    if (result) setEditing(null);
  }

  async function remove(row: Row) {
    if (!window.confirm(`Remove this ${ui.singular}? This cannot be undone.`)) return;
    await run(`${base}/${row.id}`, { method: "DELETE", success: "Removed" });
  }

  const current = editing && editing !== "new" ? editing : null;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="text-sm font-800">{ui.title}</h3>{"description" in ui && ui.description && <p className="mt-1 text-xs text-[#6b6d66]">{ui.description}</p>}</div>
      {canEdit && <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setEditing("new")}>Add {ui.singular}</Button>}
    </div>

    {rows.length ? <div className="relative overflow-x-auto rounded-lg border border-[#e7e7e3]">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead><tr className="border-b border-[#efefeb] bg-[#fafaf8] text-[9px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">
          {ui.columns.map((column) => <th key={column.key} scope="col" className="px-3 py-2.5">{column.label}</th>)}
          {canEdit && <th scope="col" className="w-20 px-3 py-2.5"><span className="sr-only">Actions</span></th>}
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} className="border-b border-[#f3f3f0] last:border-0">
          {ui.columns.map((column) => <td key={column.key} className="max-w-xs px-3 py-2.5 align-top">{formatCell(row[column.key], "format" in column ? column.format : undefined)}</td>)}
          {canEdit && <td className="px-3 py-2 text-right whitespace-nowrap">
            {canUpdate && <button type="button" onClick={() => setEditing(row)} className="rounded p-1.5 text-[#6b6d66] hover:bg-[#efefeb] hover:text-[#20211f]" aria-label={`Edit ${ui.singular}`}><Pencil size={13} /></button>}
            {"canDelete" in ui && ui.canDelete && <button type="button" onClick={() => remove(row)} disabled={pending} className="rounded p-1.5 text-[#6b6d66] hover:bg-[#f8e8df] hover:text-[#a9593d]" aria-label={`Remove ${ui.singular}`}><Trash2 size={13} /></button>}
          </td>}
        </tr>)}</tbody>
      </table>
    </div> : <EmptyState title={`No ${ui.title.toLowerCase()} yet`} />}

    {Object.entries(datalists).map(([id, values]) => <datalist key={id} id={id}>{values.map((value) => <option key={value} value={value} />)}</datalist>)}

    <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? `Edit ${ui.singular}` : `Add ${ui.singular}`} wide>
      {editing !== null && <form onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {ui.fields.map((field) => <FieldInput key={field.name} field={field} value={(current ? current[field.name] : defaults[field.name]) as string | number | boolean | null | undefined} />)}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#efefeb] pt-4">
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </div>
      </form>}
    </Dialog>
  </section>;
}
