// Accepts only same-site paths. Browsers treat "//host" and "/\host" as other
// origins, so both are rejected along with absolute URLs.
export function safePath(value: string | null | undefined, fallback: string) {
  return value && /^\/(?![/\\])/.test(value) ? value : fallback;
}
