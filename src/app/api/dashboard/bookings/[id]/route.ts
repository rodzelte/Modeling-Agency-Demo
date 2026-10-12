import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { findConflicts, setBookingTalent } from "@/features/operations/bookings";
import { bookingSchema } from "@/features/operations/schemas";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("operations.manage");
  if ("response" in auth) return auth.response;
  const parsed = bookingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase } = auth.context;
  const { talent_ids: talentIds, ...booking } = parsed.data;
  const { data, error } = await supabase.from("bookings")
    .update(definedOnly({ ...booking, start_at: new Date(booking.start_at).toISOString(), end_at: new Date(booking.end_at).toISOString() }))
    .eq("id", id).select("id,start_at,end_at").maybeSingle();
  if (error) return databaseError(error, "save the booking");
  if (!data) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (talentIds) {
    const talentError = await setBookingTalent(supabase, id, talentIds);
    if (talentError) return databaseError(talentError, "update the booking's talent");
  }
  const { data: talent } = await supabase.from("booking_talent").select("talent_id").eq("booking_id", id);
  const conflicts = await findConflicts(supabase, (talent ?? []).map((row: { talent_id: string }) => row.talent_id), data.start_at, data.end_at, id).catch(() => []);
  return NextResponse.json({ ok: true, conflicts });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("operations.manage");
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.context.supabase.from("bookings").delete().eq("id", id).select("id").maybeSingle();
  if (error) return databaseError(error, "delete the booking");
  if (!data) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
