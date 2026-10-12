import { FileText } from "lucide-react";
import { formatDate } from "@/lib/format";
import { requireEntitledPortal } from "@/features/portal/context";

export const metadata = { title: "Documents" };

export default async function PortalDocuments() {
  const { supabase } = await requireEntitledPortal();
  const { data } = await supabase.from("talent_documents").select("id,file_name,description,category,created_at").order("created_at", { ascending: false });
  return <div className="space-y-6">
    <div><h1 className="display text-5xl leading-none">Documents</h1><p className="mt-2 text-sm text-[var(--muted)]">Documents your agent has shared with you, such as contracts and call sheets.</p></div>
    {data?.length ? <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-white">{data.map((doc) => <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="flex min-w-0 items-center gap-3"><FileText size={16} className="shrink-0 text-[var(--muted)]" aria-hidden /><span className="min-w-0"><span className="block truncate font-700">{doc.file_name}</span><span className="block text-xs text-[var(--muted)]">{[doc.category, doc.description, formatDate(doc.created_at)].filter(Boolean).join(" · ")}</span></span></span>
      {/* Route handler that redirects to a 60-second signed download. */}
      <a href={`/api/portal/documents/${doc.id}`} className="shrink-0 text-[10px] font-800 uppercase tracking-[.14em] underline-offset-4 hover:underline">Download</a>
    </li>)}</ul> : <p className="text-sm text-[var(--muted)]">No documents shared with you yet.</p>}
  </div>;
}
