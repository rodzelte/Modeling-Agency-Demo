import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { findConflicts, setBookingTalent } from "@/features/operations/bookings";
import { bookingSchema } from "@/features/operations/schemas";

export async function POST(request: Request) {
  const auth = await requireApi("operations.manage");
  if ("response" in auth) return auth.response;
  const parsed = bookingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase } = auth.context;
  const { talent_ids: talentIds = [], ...booking } = parsed.data;
  const { data, error } = await supabase.from("bookings").insert(definedOnly({ ...booking, start_at: new Date(booking.start_at).toISOString(), end_at: new Date(booking.end_at).toISOString() })).select("id,reference,start_at,end_at").single();
  if (error) return databaseError(error, "create the booking");
  const talentError = await setBookingTalent(supabase, data.id, talentIds);
  if (talentError) return databaseError(talentError, "add talent to the booking");
  const conflicts = await findConflicts(supabase, talentIds, data.start_at, data.end_at, data.id).catch(() => []);
  return NextResponse.json({ id: data.id, reference: data.reference, conflicts }, { status: 201 });
}
