import { NextResponse } from "next/server";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { getModule } from "@/features/talent/modules";
import { prepareRow, RecordInputError } from "@/features/talent/record-service";
import { refreshPublicSite } from "@/features/public/cache";

type Params = { params: Promise<{ id: string; module: string; recordId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, module: moduleName, recordId } = await params;
  const config = getModule(moduleName);
  if (!config || config.singleton) return NextResponse.json({ error: "Unknown record type" }, { status: 404 });
  if (!config.canUpdate) return NextResponse.json({ error: "These records cannot be edited; add a new one instead" }, { status: 405 });

  const auth = await requireApi(config.edit);
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const { supabase } = auth.context;

  const parsed = config.schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  let row: Record<string, unknown>;
  try {
    row = await prepareRow(supabase, config.name, id, definedOnly(parsed.data as Record<string, unknown>), false);
  } catch (error) {
    if (error instanceof RecordInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }

  const { data, error } = await supabase.from(config.table).update(row).eq("id", recordId).eq("talent_id", id).select("id").maybeSingle();
  if (error) return databaseError(error, "update this record");
  if (!data) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  await writeAudit(supabase, { action: `${config.name}.updated`, entityType: "talent", entityId: id, metadata: { record_id: recordId, fields: Object.keys(row) } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id, module: moduleName, recordId } = await params;
  const config = getModule(moduleName);
  if (!config || config.singleton) return NextResponse.json({ error: "Unknown record type" }, { status: 404 });
  if (!config.canDelete) return NextResponse.json({ error: "These records are archived, not deleted" }, { status: 405 });

  const auth = await requireApi(config.edit);
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const { supabase } = auth.context;

  const { data, error } = await supabase.from(config.table).delete().eq("id", recordId).eq("talent_id", id).select("id").maybeSingle();
  if (error) return databaseError(error, "remove this record");
  if (!data) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  await writeAudit(supabase, { action: `${config.name}.removed`, entityType: "talent", entityId: id, metadata: { record_id: recordId } });
  return NextResponse.json({ ok: true });
}
