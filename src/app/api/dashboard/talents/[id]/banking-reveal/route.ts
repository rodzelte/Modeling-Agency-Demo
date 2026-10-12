import { NextResponse } from "next/server";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";

// Returns unmasked banking identifiers on explicit request, and records who looked.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("banking.view");
  if ("response" in auth) return auth.response;
  const { supabase } = auth.context;

  const { data, error } = await supabase.from("talent_banking").select("account_number,routing_number,swift_aba").eq("talent_id", id).maybeSingle();
  if (error) return databaseError(error, "load banking details");
  if (!data) return NextResponse.json({ error: "No banking record" }, { status: 404 });

  await writeAudit(supabase, { action: "banking.revealed", entityType: "talent", entityId: id, metadata: { fields: ["account_number", "routing_number", "swift_aba"] } });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
