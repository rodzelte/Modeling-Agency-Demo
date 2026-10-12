// Pure export helpers (CSV and iCalendar), unit-tested in tests/unit/operations.test.mts.

// Cells that start with = + - @ are prefixed with ' so spreadsheet apps never run
// them as formulas (CSV injection); quotes, commas and newlines are quoted.
export function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// RFC 5545 text escaping, UTC timestamps, and 75-octet line folding.
export const icsEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
export const icsStamp = (value: string | Date) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export const icsFold = (line: string) => (line.length <= 74 ? line : line.match(/.{1,74}/g)!.join("\r\n "));
