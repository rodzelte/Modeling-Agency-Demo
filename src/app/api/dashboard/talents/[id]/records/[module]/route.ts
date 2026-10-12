import { NextResponse } from "next/server";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { getModule } from "@/features/talent/modules";
import { prepareRow, RecordInputError } from "@/features/talent/record-service";
import { refreshPublicSite } from "@/features/public/cache";

type Params = { params: Promise<{ id: string; module: string }> };

async function write(request: Request, { params }: Params, mode: "create" | "upsert") {
  const { id, module: moduleName } = await params;
  const config = getModule(moduleName);
  if (!config) return NextResponse.json({ error: "Unknown record type" }, { status: 404 });
  if (Boolean(config.singleton) !== (mode === "upsert")) return NextResponse.json({ error: "Method not allowed" }, { status: 405 });

  const auth = await requireApi(config.edit);
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const { supabase } = auth.context;

  const parsed = config.schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  let row: Record<string, unknown>;
  try {
    row = await prepareRow(supabase, config.name, id, definedOnly(parsed.data as Record<string, unknown>), mode === "create");
  } catch (error) {
    if (error instanceof RecordInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }

  const query = mode === "upsert"
    ? supabase.from(config.table).upsert({ talent_id: id, ...row }, { onConflict: "talent_id" })
    : supabase.from(config.table).insert({ talent_id: id, ...row });
  const { data, error } = await query.select("*").single();
  if (error) return databaseError(error, "save this record");

  if (!config.auditedByDatabase) {
    await writeAudit(supabase, { action: `${config.name}.added`, entityType: "talent", entityId: id, metadata: { record_id: data?.id ?? null, fields: Object.keys(row) } });
  }
  return NextResponse.json({ id: data?.id ?? id }, { status: mode === "create" ? 201 : 200 });
}

export async function POST(request: Request, context: Params) {
  return write(request, context, "create");
}

export async function PUT(request: Request, context: Params) {
  return write(request, context, "upsert");
}
