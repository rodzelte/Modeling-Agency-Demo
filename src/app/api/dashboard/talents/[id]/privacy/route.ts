import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { refreshPublicSite } from "@/features/public/cache";
import { collectTalentData, talentFiles } from "@/features/privacy/talent-data";

// Data-subject requests (UK GDPR / CCPA), owner only.
// GET  → everything held about the talent as JSON (right of access/portability).
// POST → erase the talent: stored files first, then the record and every
//        dependent row (cascade), plus applications that became this talent.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("team.manage");
  if ("response" in auth) return auth.response;
  const { supabase } = auth.context;
  try {
    const data = await collectTalentData(supabase, id);
    if (!data) return NextResponse.json({ error: "Talent not found" }, { status: 404 });
    const files = await talentFiles(supabase, id);
    await writeAudit(supabase, { action: "privacy.exported", entityType: "talent", entityId: id });
    return new NextResponse(JSON.stringify({ ...data, stored_files: files }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="talent-data-${id}.json"`, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return databaseError(error as { message?: string }, "export the data");
  }
}

const eraseSchema = z.object({ confirm: z.string().trim() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi(["team.manage", "talent.delete"]);
  if ("response" in auth) return auth.response;
  const parsed = eraseSchema.safeParse(await request.json().catch(() => null));
  const { supabase } = auth.context;
  const { data: talent } = await supabase.from("talent").select("id,display_name").eq("id", id).maybeSingle();
  if (!talent) return NextResponse.json({ error: "Talent not found" }, { status: 404 });
  if (!parsed.success || parsed.data.confirm !== talent.display_name) return NextResponse.json({ error: `Type the talent's name exactly (${talent.display_name}) to confirm` }, { status: 400 });

  refreshPublicSite();
  try {
    const files = await talentFiles(supabase, id);
    for (const [bucket, paths] of Object.entries(files)) {
      for (let index = 0; index < paths.length; index += 100) {
        const { error } = await supabase.storage.from(bucket).remove(paths.slice(index, index + 100));
        if (error) throw error;
      }
    }
    await supabase.from("applications").delete().eq("converted_talent_id", id);
    const { error } = await supabase.from("talent").delete().eq("id", id);
    if (error) throw error;
    // No name or other personal data in the audit trail: only that an erasure happened.
    await writeAudit(supabase, { action: "privacy.erased", entityType: "talent", entityId: id, metadata: { files: Object.values(files).flat().length } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("privacy", "erase failed", error, { talent: id });
    return databaseError(error as { message?: string }, "erase this talent");
  }
}
