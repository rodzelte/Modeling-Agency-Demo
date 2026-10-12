import { NextResponse } from "next/server";
import { databaseError, redirectTo, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";

// Private documents are never linked directly: each download is authorised,
// audited, and served through a signed URL that expires after 60 seconds.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await params;
  const auth = await requireApi("documents.view");
  if ("response" in auth) return auth.response;
  const { supabase } = auth.context;

  const { data: document, error } = await supabase.from("talent_documents").select("id,file_name,storage_path").eq("id", documentId).eq("talent_id", id).maybeSingle();
  if (error) return databaseError(error, "load the document");
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const { data: signed, error: signError } = await supabase.storage.from("talent-documents").createSignedUrl(document.storage_path, 60, { download: document.file_name });
  if (signError || !signed) return databaseError(signError, "prepare the download");

  await writeAudit(supabase, { action: "document.accessed", entityType: "talent", entityId: id, metadata: { document_id: document.id } });
  return redirectTo(signed.signedUrl, 307, { "Cache-Control": "no-store" });
}
