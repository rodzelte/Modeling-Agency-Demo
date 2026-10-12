import { NextResponse } from "next/server";
import { requireApi } from "@/lib/agency-auth";
import { databaseError } from "@/lib/api";
import { icsEscape as escape, icsFold as fold, icsStamp as stamp } from "@/features/operations/export";

// Downloads one booking, or a talent's next 12 months, as an .ics file that
// Google Calendar, Outlook and Apple Calendar can import. Read-only.
type Row = { id: string; reference: string; title: string; status: string; start_at: string; end_at: string; location: string | null; booking_talent: { talent: { display_name: string } | { display_name: string }[] | null }[] };

export async function GET(request: Request) {
  const auth = await requireApi("operations.view");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const bookingId = url.searchParams.get("booking");
  const talentId = url.searchParams.get("talent");
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!(bookingId && uuid.test(bookingId)) && !(talentId && uuid.test(talentId))) return NextResponse.json({ error: "Choose a booking or a talent" }, { status: 400 });

  const columns = talentId ? "id,reference,title,status,start_at,end_at,location,booking_talent!inner(talent_id,talent:talent_id(display_name))" : "id,reference,title,status,start_at,end_at,location,booking_talent(talent:talent_id(display_name))";
  let query = auth.context.supabase.from("bookings").select(columns).neq("status", "cancelled");
  if (bookingId) query = query.eq("id", bookingId);
  else query = query.eq("booking_talent.talent_id", talentId as string).gte("end_at", new Date().toISOString()).lte("start_at", new Date(Date.now() + 365 * 86400000).toISOString()).order("start_at").limit(500);
  const { data, error } = await query;
  if (error) return databaseError(error, "export the calendar");

  const now = stamp(new Date());
  const events = ((data ?? []) as unknown as Row[]).map((row) => {
    const talent = row.booking_talent.map((item) => (Array.isArray(item.talent) ? item.talent[0] : item.talent)?.display_name).filter(Boolean).join(", ");
    return [
      "BEGIN:VEVENT",
      `UID:${row.id}@42modelmanagement`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(row.start_at)}`,
      `DTEND:${stamp(row.end_at)}`,
      fold(`SUMMARY:${escape(`${row.status === "option" ? "[Option] " : ""}${row.title}`)}`),
      row.location ? fold(`LOCATION:${escape(row.location)}`) : null,
      fold(`DESCRIPTION:${escape(`${row.reference}${talent ? ` — ${talent}` : ""}`)}`),
      `STATUS:${row.status === "option" ? "TENTATIVE" : "CONFIRMED"}`,
      "END:VEVENT",
    ].filter(Boolean).join("\r\n");
  });
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//42 Model Management//Bookings//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR", ""].join("\r\n");
  return new NextResponse(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${bookingId ? "booking" : "talent-schedule"}.ics"`, "Cache-Control": "private, no-store" } });
}
