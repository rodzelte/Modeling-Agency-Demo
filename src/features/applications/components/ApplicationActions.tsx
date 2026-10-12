"use client";

import { useRouter } from "next/navigation";
import { Archive, Check, Mail, MessageCircleQuestion, UserPlus, X } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { useMutation } from "@/lib/use-mutation";
import type { ApplicationStatus } from "../queries";

export function ApplicationActions({ id, status, email, convertedTalentId, canManage, canConvert, canErase = false }: {
  id: string; status: ApplicationStatus; email: string | null; convertedTalentId: string | null; canManage: boolean; canConvert: boolean; canErase?: boolean;
}) {
  const router = useRouter();
  const { run, pending } = useMutation();
  const setStatus = (next: ApplicationStatus, success: string) => run(`/api/dashboard/applications/${id}`, { method: "PATCH", body: { status: next }, success });

  async function convert() {
    if (!window.confirm("Create a draft talent record from this application? Details and photos are copied; nothing is published.")) return;
    const result = await run<{ talent_id: string; photos_copied: number; photos_need_media_permission: boolean }>(`/api/dashboard/applications/${id}/convert`, { success: "Draft talent created", refresh: false });
    if (result?.talent_id) router.push(`/dashboard/talent/${result.talent_id}`);
  }

  if (status === "converted" && convertedTalentId) {
    return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#b7cdb9] bg-[#f3f8f3] px-4 py-3 text-sm">
      <Check size={16} className="text-[#4f7a54]" aria-hidden />Converted to a draft talent record.
      <ButtonLink href={`/dashboard/talent/${convertedTalentId}`} size="sm" variant="secondary">Open talent</ButtonLink>
    </div>;
  }
  if (!canManage) return null;

  return <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e7e7e3] bg-white p-3">
    {status === "new" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => setStatus("reviewing", "Marked as reviewing")}>Start review</Button>}
    {status !== "approved" && <Button size="sm" variant="success" icon={<Check size={13} />} disabled={pending} onClick={() => setStatus("approved", "Approved")}>Approve</Button>}
    {canConvert && <Button size="sm" icon={<UserPlus size={13} />} disabled={pending} onClick={convert}>Convert to talent</Button>}
    {status !== "info_requested" && <Button size="sm" variant="secondary" icon={<MessageCircleQuestion size={13} />} disabled={pending} onClick={() => setStatus("info_requested", "Marked as waiting for information")}>Request info</Button>}
    {email && <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[10px] font-800 uppercase tracking-[.12em] text-[#5f615b] hover:bg-[#efefeb]"><Mail size={13} aria-hidden />Email</a>}
    <span className="ml-auto flex flex-wrap gap-2">
      {status !== "rejected" && <Button size="sm" variant="danger" icon={<X size={13} />} disabled={pending} onClick={() => window.confirm("Reject this application?") && setStatus("rejected", "Rejected")}>Reject</Button>}
      {status !== "archived" && <Button size="sm" variant="ghost" icon={<Archive size={13} />} disabled={pending} onClick={() => setStatus("archived", "Archived")}>Archive</Button>}
      {(status === "rejected" || status === "archived") && <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStatus("new", "Reopened")}>Reopen</Button>}
      {canErase && <Button size="sm" variant="danger" disabled={pending} onClick={async () => {
        if (!window.confirm("Erase this application and its photos permanently? Use this for deletion requests. It cannot be undone.")) return;
        if (await run(`/api/dashboard/applications/${id}`, { method: "DELETE", success: "Application erased", refresh: false })) router.push("/dashboard/applications");
      }}>Erase</Button>}
    </span>
  </div>;
}
