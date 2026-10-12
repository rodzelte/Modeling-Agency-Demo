// Structured server logging. One JSON line per event, so Vercel's log search and
// any log drain can filter by level/scope. Never pass values such as DOBs, phone
// numbers, tokens, or request headers: log identifiers and error codes only.
type Level = "info" | "warn" | "error";
type Details = Record<string, string | number | boolean | null | undefined>;

function write(level: Level, scope: string, message: string, details: Details = {}) {
  const line = JSON.stringify({ level, scope, message, ...details, at: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

// Accepts Supabase/PostgREST errors, thrown Errors, or anything else.
export function errorDetails(error: unknown): Details {
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown; digest?: unknown };
    return {
      code: typeof value.code === "string" ? value.code : undefined,
      error: typeof value.message === "string" ? value.message.slice(0, 500) : undefined,
      digest: typeof value.digest === "string" ? value.digest : undefined,
    };
  }
  return { error: String(error).slice(0, 500) };
}

export const log = {
  info: (scope: string, message: string, details?: Details) => write("info", scope, message, details),
  warn: (scope: string, message: string, details?: Details) => write("warn", scope, message, details),
  error: (scope: string, message: string, error?: unknown, details?: Details) =>
    write("error", scope, message, { ...(error === undefined ? {} : errorDetails(error)), ...details }),
};
