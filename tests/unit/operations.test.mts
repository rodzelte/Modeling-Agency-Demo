// Operations helpers: exports and calendar maths. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, icsEscape, icsFold, icsStamp } from "../../src/features/operations/export.ts";
import { coveredDays, localDay, monthGrid, parseMonth, shiftMonth } from "../../src/features/operations/calendar.ts";

test("CSV cells cannot become spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), "\"'=HYPERLINK(\"\"http://evil\"\")\"");
  assert.equal(csvCell("+1 555"), "'+1 555");
  assert.equal(csvCell("-10"), "'-10");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("Acme, Inc"), "\"Acme, Inc\"");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(2500), "2500");
});

test("iCalendar text is escaped, stamped in UTC and folded", () => {
  assert.equal(icsEscape("a;b,c\\d\ne"), "a\\;b\\,c\\\\d\\ne");
  assert.equal(icsStamp("2026-10-05T09:00:00.000Z"), "20261005T090000Z");
  const folded = icsFold(`SUMMARY:${"x".repeat(100)}`);
  assert.ok(folded.split("\r\n").every((line) => line.length <= 75));
  assert.ok(folded.includes("\r\n "));
});

test("month grid starts on Monday and covers the month", () => {
  const weeks = monthGrid(2026, 10);
  assert.equal(weeks[0][0], "2026-09-28");
  assert.ok(weeks.flat().includes("2026-10-31"));
  assert.ok(weeks.every((week) => week.length === 7));
  assert.ok(weeks.length >= 4 && weeks.length <= 6);
});

test("month navigation wraps years", () => {
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(parseMonth("2026-13"), { year: 2026, month: 12 });
});

test("days are counted in the agency's time zone", () => {
  // 03:00 UTC on 6 Oct is still 5 Oct in Dallas.
  assert.equal(localDay("2026-10-06T03:00:00Z"), "2026-10-05");
  assert.deepEqual(coveredDays("2026-10-05T14:00:00Z", "2026-10-07T20:00:00Z"), ["2026-10-05", "2026-10-06", "2026-10-07"]);
});
