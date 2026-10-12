import { NextResponse } from "next/server";
import { databaseError, redirectTo, writeAudit } from "@/lib/api";
import { requireEntitledPortalApi } from "@/features/portal/context";

// Downloads a document the agency shared with this talent (60-second signed URL).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireEntitledPortalApi();
  if ("response" in auth) return auth.response;
  const { supabase, profile } = auth.portal;
  const { data: document, error } = await supabase.from("talent_documents").select("id,file_name,storage_path").eq("id", id).eq("talent_id", profile.id).maybeSingle();
  if (error) return databaseError(error, "open the document");
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const { data: signed, error: signError } = await supabase.storage.from("talent-documents").createSignedUrl(document.storage_path, 60, { download: document.file_name });
  if (signError || !signed) return databaseError(signError, "open the document");
  await writeAudit(supabase, { action: "portal.document_downloaded", entityType: "talent", entityId: profile.id, metadata: { document_id: id } }).catch(() => undefined);
  return redirectTo(signed.signedUrl, 303);
}
