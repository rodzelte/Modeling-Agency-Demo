import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { formatDate, formatDateTime } from "@/lib/format";
import type { BookingRow } from "../queries";
import { LABELS } from "../schemas";

export const BOOKING_TONES: Record<string, BadgeTone> = { option: "review", confirmed: "public", cancelled: "inactive", completed: "archived" };

export function BookingStatus({ status }: { status: string }) {
  return <Badge tone={BOOKING_TONES[status] ?? "neutral"}>{LABELS.status[status as keyof typeof LABELS.status] ?? status}</Badge>;
}

export function bookingWhen(row: Pick<BookingRow, "start_at" | "end_at" | "all_day">) {
  if (row.all_day) {
    const start = formatDate(row.start_at);
    const end = formatDate(row.end_at);
    return start === end ? `${start} (all day)` : `${start} – ${end}`;
  }
  return `${formatDateTime(row.start_at)} – ${new Date(row.end_at).toDateString() === new Date(row.start_at).toDateString() ? new Date(row.end_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : formatDateTime(row.end_at)}`;
}

// Compact list used on company, talent and dashboard pages.
export function BookingList({ rows, empty }: { rows: BookingRow[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-[#6b6d66]">{empty}</p>;
  return <ul className="divide-y divide-[#f3f3f0] text-sm">{rows.map((row) => <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
    <div className="min-w-0">
      <Link href={`/dashboard/bookings/${row.id}`} className="font-700 hover:text-[#a4502f]">{row.title}</Link>
      <p className="text-xs text-[#6b6d66]">{row.reference} · {bookingWhen(row)}{row.company ? ` · ${row.company.name}` : ""}</p>
      {row.talent.length > 0 && <p className="mt-0.5 text-xs text-[#5f615b]">{row.talent.map((item) => item.display_name).join(", ")}</p>}
    </div>
    <BookingStatus status={row.status} />
  </li>)}</ul>;
}
