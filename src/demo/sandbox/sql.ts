// SQL text helpers and the sandbox's error type. No imports: safe to load anywhere.
// SQL literal of unknown type, the way PostgREST passes filter values: Postgres
// coerces it to the column's type. standard_conforming_strings is on, so only
// the quote needs doubling.
export function lit(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (text.includes("\u0000")) throw new SandboxError("22021", "Invalid character in value", 400);
  return `'${text.replace(/'/g, "''")}'`;
}

export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export class SandboxError extends Error {
  code: string;
  status: number;
  details: string | null;
  hint: string | null;
  constructor(code: string, message: string, status = 400, details: string | null = null, hint: string | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.hint = hint;
  }
}
