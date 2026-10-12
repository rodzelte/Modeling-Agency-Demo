// Relative (not @/) so the unit tests can import this module directly.
import { AGENCY_TIME_ZONE } from "../../lib/site.ts";

// Calendar maths in the agency's time zone (the server runs in UTC).
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: AGENCY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function localDay(value: string | Date) {
  return dayKey.format(typeof value === "string" ? new Date(value) : value); // YYYY-MM-DD
}

export function parseMonth(value: string | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  const today = localDay(new Date());
  const year = match ? Number(match[1]) : Number(today.slice(0, 4));
  const month = match ? Math.min(12, Math.max(1, Number(match[2]))) : Number(today.slice(5, 7));
  return { year, month };
}

const pad = (value: number) => String(value).padStart(2, "0");
export const monthKey = (year: number, month: number) => `${year}-${pad(month)}`;
export function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// Monday-first grid of YYYY-MM-DD strings covering the month.
export function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * 86400000);
  const days: string[] = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(start.getTime() + index * 86400000);
    days.push(`${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`);
  }
  const weeks = [];
  for (let index = 0; index < 42; index += 7) weeks.push(days.slice(index, index + 7));
  // Drop a trailing week that is entirely in the next month.
  return weeks.filter((week, index) => index < 4 || week.some((day) => day.startsWith(monthKey(year, month))));
}

// Days (YYYY-MM-DD, agency time) an event covers.
export function coveredDays(startAt: string, endAt: string) {
  const days: string[] = [];
  const end = localDay(endAt);
  let cursor = new Date(startAt);
  for (let guard = 0; guard < 62; guard += 1) {
    const day = localDay(cursor);
    days.push(day);
    if (day >= end) break;
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return days;
}

export function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
