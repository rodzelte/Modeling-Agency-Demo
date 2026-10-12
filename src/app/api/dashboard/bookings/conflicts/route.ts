import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { findConflicts } from "@/features/operations/bookings";

const schema = z.object({
  talent_ids: z.array(z.string().uuid()).max(50),
  start_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  end_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  exclude_booking: z.string().uuid().optional(),
});

// Live double-booking check while a booking form is being filled in.
export async function POST(request: Request) {
  const auth = await requireApi("operations.view");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ conflicts: [] });
  try {
    const conflicts = await findConflicts(auth.context.supabase, parsed.data.talent_ids, new Date(parsed.data.start_at).toISOString(), new Date(parsed.data.end_at).toISOString(), parsed.data.exclude_booking);
    return NextResponse.json({ conflicts });
  } catch (error) {
    return databaseError(error as { message?: string }, "check for conflicts");
  }
}
