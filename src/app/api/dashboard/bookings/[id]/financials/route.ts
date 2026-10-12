import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { financialsSchema } from "@/features/operations/schemas";

// Fees, commission, invoice and payment status. Audited by the database without amounts.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("finance.manage");
  if ("response" in auth) return auth.response;
  const parsed = financialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase } = auth.context;
  const { talent_fees: talentFees, ...financials } = parsed.data;
  const { error } = await supabase.from("booking_financials").upsert({ booking_id: id, ...financials }, { onConflict: "booking_id" });
  if (error) return databaseError(error, "save the fees");
  if (talentFees?.length) {
    const { error: feeError } = await supabase.from("booking_talent_fees")
      .upsert(talentFees.map((fee) => ({ booking_id: id, talent_id: fee.talent_id, fee: fee.fee ?? null, paid_to_talent_on: fee.paid_to_talent_on ?? null })), { onConflict: "booking_id,talent_id" });
    if (feeError) return databaseError(feeError, "save the talent fees");
  }
  return NextResponse.json({ ok: true });
}
