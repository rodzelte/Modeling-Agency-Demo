"use client";

import { useState } from "react";
import { Eye, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { readForm } from "@/lib/read-form";
import { useMutation } from "@/lib/use-mutation";
import { formatDateTime } from "@/lib/format";
import { singletonUi, type SingletonKey } from "../fields";
import { FieldInput } from "./FieldInput";

// One-record-per-talent modules (legal, identification, banking, medical).
// Saves are partial upserts, so a form showing a subset leaves other fields intact.
export function SingletonForm({ talentId, module, ui, record, canEdit, description }: {
  talentId: string; module: "legal" | "banking" | "medical"; ui: SingletonKey; record: Record<string, unknown> | null; canEdit: boolean; description?: string;
}) {
  const config = singletonUi[ui];
  const { run, pending } = useMutation();
  const toast = useToast();
  const [revealed, setRevealed] = useState<Record<string, string> | null>(null);
  const masked = module === "banking";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = readForm(event.currentTarget);
    await run(`/api/dashboard/talents/${talentId}/records/${module}`, { method: "PUT", body, success: `${config.title} saved` });
    setRevealed(null);
  }

  async function reveal() {
    const response = await fetch(`/api/dashboard/talents/${talentId}/banking-reveal`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) toast.error(payload?.error ?? "Could not reveal banking details");
    else setRevealed(payload);
  }

  return <form onSubmit={submit} className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-800"><Lock size={13} className="text-[#a9593d]" aria-hidden />{config.title}</h3>
        <p className="mt-1 text-xs text-[#6b6d66]">{description ?? "Restricted. Access and changes are recorded in the audit log."}</p>
      </div>
      {typeof record?.updated_at === "string" && <p className="text-[11px] text-[#717369]">Last updated {formatDateTime(record.updated_at)}</p>}
    </div>

    {masked && record && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#efe0d8] bg-[#fdf8f5] px-4 py-3 text-xs">
      <span className="flex-1">Saved identifiers: account {String(revealed?.account_number ?? record.account_number ?? "—")}, routing {String(revealed?.routing_number ?? record.routing_number ?? "—")}, SWIFT/ABA {String(revealed?.swift_aba ?? record.swift_aba ?? "—")}</span>
      {!revealed && <Button size="sm" variant="secondary" icon={<Eye size={13} />} onClick={reveal}>Reveal</Button>}
    </div>}

    <div className="grid gap-4 sm:grid-cols-2">
      {config.fields.map((field) => <FieldInput key={field.name} field={field} disabled={!canEdit}
        value={masked && ["account_number", "routing_number", "swift_aba"].includes(field.name) ? "" : (record?.[field.name] as string | number | boolean | null | undefined)} />)}
    </div>
    {canEdit && <div className="flex justify-end border-t border-[#efefeb] pt-4"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></div>}
  </form>;
}
