import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { AGENCY_TIME_ZONE } from "@/lib/site";
import { coveredDays, localDay, monthGrid, monthKey, parseMonth, shiftMonth, timeLabel } from "@/features/operations/calendar";
import { calendarItems, talentOptions, type CalendarItem } from "@/features/operations/queries";

export const metadata = { title: "Calendar" };

const STYLES: Record<string, string> = {
  confirmed: "bg-[#20211f] text-white",
  option: "bg-[#f7ecd8] text-[#6f5a35] ring-1 ring-inset ring-[#e8d3ad]",
  completed: "bg-[#ecebf3] text-[#6a6789]",
  appointment: "bg-[#e4eee5] text-[#3f6b45]",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; talent?: string }> }) {
  const context = await requirePage("operations.view");
  if (!context) return <UnauthorizedState />;
  const search = await searchParams;
  const { year, month } = parseMonth(search.month);
  const weeks = monthGrid(year, month);
  const talentId = search.talent && /^[0-9a-f-]{36}$/i.test(search.talent) ? search.talent : undefined;
  const from = new Date(`${weeks[0][0]}T00:00:00Z`);
  const to = new Date(new Date(`${weeks[weeks.length - 1][6]}T23:59:59Z`).getTime() + 86400000);

  let items: CalendarItem[];
  let talent: { id: string; display_name: string }[];
  try {
    [items, talent] = await Promise.all([calendarItems(context.supabase, from, to, talentId), talentOptions(context.supabase)]);
  } catch (error) {
    log.error("operations", "calendar failed", error);
    return <ErrorState title="The calendar could not be loaded" />;
  }
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) for (const day of coveredDays(item.start_at, item.end_at)) byDay.set(day, [...(byDay.get(day) ?? []), item]);
  const today = localDay(new Date());
  const current = monthKey(year, month);
  const link = (target: { year: number; month: number }) => `/dashboard/calendar?month=${monthKey(target.year, target.month)}${talentId ? `&talent=${talentId}` : ""}`;
  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
  const canManage = context.permissions.has("operations.manage");

  return <div className="space-y-6">
    <PageHeader eyebrow="Operations" title="Calendar" description={`Bookings and appointments, shown in ${AGENCY_TIME_ZONE.replace("_", " ")} time.`}
      actions={<div className="flex flex-wrap gap-2">
        {talentId && <a href={`/api/dashboard/calendar/ics?talent=${talentId}`} className={buttonClass("secondary")}><Download size={14} aria-hidden />Export .ics</a>}
        {canManage && <ButtonLink href="/dashboard/bookings/new" icon={<Plus size={14} />}>New booking</ButtonLink>}
      </div>} />

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Link href={link(shiftMonth(year, month, -1))} aria-label="Previous month" className="rounded-md border border-[#e7e7e3] bg-white p-2 hover:border-[#20211f]"><ChevronLeft size={16} /></Link>
        <h2 className="min-w-44 text-center text-lg font-700">{title}</h2>
        <Link href={link(shiftMonth(year, month, 1))} aria-label="Next month" className="rounded-md border border-[#e7e7e3] bg-white p-2 hover:border-[#20211f]"><ChevronRight size={16} /></Link>
        <Link href={`/dashboard/calendar${talentId ? `?talent=${talentId}` : ""}`} className="ml-2 text-xs text-[#5f615b] hover:underline">Today</Link>
      </div>
      <form className="flex items-center gap-2">
        <input type="hidden" name="month" value={current} />
        <label htmlFor="calendar-talent" className="sr-only">Talent</label>
        <select id="calendar-talent" name="talent" defaultValue={talentId ?? ""} className="rounded-md border border-[#dcdcd6] bg-white px-3 py-2 text-sm"><option value="">All talent</option>{talent.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select>
        <button className={buttonClass("secondary", "sm")}>Show</button>
      </form>
    </div>

    <div className="flex flex-wrap gap-3 text-[11px] text-[#5f615b]">
      {[["confirmed", "Confirmed"], ["option", "Option"], ["completed", "Completed"], ["appointment", "Appointment"]].map(([key, label]) => <span key={key} className="flex items-center gap-1.5"><span className={`h-3 w-3 rounded-sm ${STYLES[key]}`} aria-hidden />{label}</span>)}
    </div>

    {/* Month grid on tablets and up; a day list on phones. */}
    <div className="hidden overflow-hidden rounded-xl border border-[#e7e7e3] bg-white md:block">
      <div className="grid grid-cols-7 border-b border-[#efefeb] text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66]">{WEEKDAYS.map((day) => <div key={day} className="px-2 py-2">{day}</div>)}</div>
      {weeks.map((week) => <div key={week[0]} className="grid grid-cols-7 border-b border-[#f3f3f0] last:border-0">{week.map((day) => {
        const inMonth = day.startsWith(current);
        const events = byDay.get(day) ?? [];
        return <div key={day} className={`min-h-28 min-w-0 border-r border-[#f3f3f0] p-1.5 last:border-r-0 ${inMonth ? "" : "bg-[#fafaf8]"}`}>
          <div className="flex items-center justify-between">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${day === today ? "bg-[#a4502f] font-800 text-white" : inMonth ? "text-[#20211f]" : "text-[#717369]"}`}>{Number(day.slice(8))}</span>
            {canManage && inMonth && <Link href={`/dashboard/bookings/new?date=${day}${talentId ? `&talent=${talentId}` : ""}`} aria-label={`New booking on ${day}`} className="rounded p-0.5 text-[#717369] opacity-0 hover:text-[#20211f] focus:opacity-100 [div:hover>&]:opacity-100"><Plus size={12} /></Link>}
          </div>
          <ul className="mt-1 space-y-1">{events.slice(0, 4).map((event) => <li key={`${event.kind}-${event.id}`}>
            <Link href={event.href} title={`${event.title}${event.talent.length ? ` — ${event.talent.join(", ")}` : ""}`} className={`block truncate rounded px-1.5 py-0.5 text-[10px] font-700 ${STYLES[event.kind === "appointment" ? "appointment" : event.status] ?? STYLES.option}`}>
              {localDay(event.start_at) === day && <span className="font-400 opacity-80">{timeLabel(event.start_at)} </span>}{event.title}
            </Link>
          </li>)}{events.length > 4 && <li className="px-1.5 text-[10px] text-[#6b6d66]">+{events.length - 4} more</li>}</ul>
        </div>;
      })}</div>)}
    </div>

    <ol className="space-y-3 md:hidden">{weeks.flat().filter((day) => day.startsWith(current) && byDay.has(day)).map((day) => <li key={day} className="rounded-xl border border-[#e7e7e3] bg-white p-3">
      <p className={`text-xs font-800 ${day === today ? "text-[#a4502f]" : "text-[#5f615b]"}`}>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</p>
      <ul className="mt-2 space-y-1.5">{(byDay.get(day) ?? []).map((event) => <li key={`${event.kind}-${event.id}`}><Link href={event.href} className={`block rounded px-2 py-1.5 text-xs font-700 ${STYLES[event.kind === "appointment" ? "appointment" : event.status] ?? STYLES.option}`}>{timeLabel(event.start_at)} · {event.title}{event.talent.length > 0 && <span className="block font-400 opacity-80">{event.talent.join(", ")}</span>}</Link></li>)}</ul>
    </li>)}</ol>
    {items.length === 0 && <p className="text-center text-sm text-[#6b6d66]">Nothing scheduled this month.</p>}
  </div>;
}
