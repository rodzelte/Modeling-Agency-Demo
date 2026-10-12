"use client";

import { useRef, useState } from "react";
import { Archive, ArchiveRestore, Download, FileText, Upload } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { useMutation } from "@/lib/use-mutation";

export type TalentDocument = { id: string; file_name: string; description: string | null; category: string | null; visibility: string; mime_type: string | null; file_size: number | null; created_at: string; archived_at: string | null; shared_with_talent?: boolean };

const ACCEPTED = {
  "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG", "text/plain": "TXT",
  "application/msword": "DOC", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
} as Record<string, string>;
const MAX_BYTES = 25 * 1024 * 1024;
const CATEGORIES = ["Contract", "Identification", "Tax", "Release", "Medical clearance", "Work permit", "Other"].map((value) => ({ value, label: value }));

// Private documents: stored in the private talent-documents bucket, downloaded only
// through an audited, short-lived signed URL.
export function DocumentManager({ talentId, documents, canManage }: { talentId: string; documents: TalentDocument[]; canManage: boolean }) {
  const { run, pending } = useMutation();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [uploading, setUploading] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const base = `/api/dashboard/talents/${talentId}/records/documents`;
  const visible = documents.filter((document) => showArchived || !document.archived_at);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) return toast.error("Choose a file to upload.");
    if (!ACCEPTED[file.type] || file.size > MAX_BYTES) return toast.error("Upload PDF, Word, Excel, text, JPG, or PNG files up to 25 MB.");
    setUploading(true);
    const path = `talent/${talentId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100)}`;
    const stored = await createClient().storage.from("talent-documents").upload(path, file, { contentType: file.type });
    if (stored.error) {
      toast.error("The file could not be uploaded.");
    } else if (await run(base, { body: { file_name: file.name, storage_path: path, category: data.get("category") || "", description: data.get("description") || "", visibility: data.get("visibility") || "private", mime_type: file.type, file_size: file.size }, success: "Document uploaded" })) {
      form.current?.reset();
    }
    setUploading(false);
  }

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="text-sm font-800">Documents</h3><p className="mt-1 text-xs text-[#6b6d66]">Contracts, identification, and other private files. Every download is logged.</p></div>
      <label className="flex items-center gap-2 text-xs text-[#6f716b]"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="accent-[#20211f]" />Show archived</label>
    </div>

    {canManage && <form ref={form} onSubmit={upload} className="grid gap-4 rounded-lg border border-[#e7e7e3] p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b] sm:col-span-2 lg:col-span-1">File<input name="file" type="file" required accept={Object.keys(ACCEPTED).join(",")} className="mt-2 block w-full text-xs font-400 normal-case tracking-normal" /></label>
      <SelectField label="Category" name="category" options={CATEGORIES} placeholder="—" />
      <SelectField label="Visibility" name="visibility" defaultValue="private" options={[{ value: "private", label: "Private (restricted roles)" }, { value: "staff", label: "Staff" }]} />
      <TextField label="Description" name="description" />
      <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><Button type="submit" size="sm" icon={<Upload size={13} />} disabled={uploading || pending}>{uploading ? "Uploading…" : "Upload document"}</Button></div>
    </form>}

    {visible.length ? <ul className="divide-y divide-[#efefeb] rounded-lg border border-[#e7e7e3]">{visible.map((document) => <li key={document.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs">
      <FileText size={16} className="text-[#717369]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-700">{document.file_name}</p>
        <p className="text-[11px] text-[#6b6d66]">{[document.category, document.mime_type ? ACCEPTED[document.mime_type] : null, document.file_size ? `${Math.max(1, Math.round(document.file_size / 1024))} KB` : null, `Uploaded ${formatDate(document.created_at)}`].filter(Boolean).join(" · ")}</p>
        {document.description && <p className="mt-0.5 text-[11px] text-[#6f716b]">{document.description}</p>}
      </div>
      {document.archived_at && <Badge tone="archived">Archived</Badge>}
      <Badge tone={document.visibility === "private" ? "internal" : "neutral"}>{document.visibility}</Badge>
      {document.shared_with_talent && <Badge tone="public">Shared with talent</Badge>}
      {canManage && !document.archived_at && <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => run(`${base}/${document.id}`, { method: "PATCH", body: { shared_with_talent: !document.shared_with_talent }, success: document.shared_with_talent ? "No longer shared with the talent" : "Shared in the talent portal" })}>
        {document.shared_with_talent ? "Unshare" : "Share with talent"}
      </Button>}
      <a href={`/api/dashboard/talents/${talentId}/documents/${document.id}/download`} className="inline-flex items-center gap-1.5 rounded-md border border-[#e7e7e3] px-3 py-2 text-[10px] font-800 uppercase tracking-[.12em] hover:border-[#20211f]"><Download size={12} />Download</a>
      {canManage && <Button size="sm" variant="ghost" icon={document.archived_at ? <ArchiveRestore size={12} /> : <Archive size={12} />} disabled={pending}
        onClick={() => run(`${base}/${document.id}`, { method: "PATCH", body: { archived: !document.archived_at }, success: document.archived_at ? "Document restored" : "Document archived" })}>
        {document.archived_at ? "Restore" : "Archive"}
      </Button>}
    </li>)}</ul> : <EmptyState title="No documents" />}
  </section>;
}
