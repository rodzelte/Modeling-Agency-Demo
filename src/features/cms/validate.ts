import { isReservedSlug, pageMetaSchema, parseSections, type Section } from "./blocks";
import { sanitizeBlockHtml } from "./sanitize";

// Server-side page validation for the editor API: meta fields, reserved slugs,
// per-block schemas, and sanitising custom HTML before it is stored. Custom CSS
// is stored as written and scoped to its block when rendered.
export function validatePageInput(body: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected page details" };
  const input = body as Record<string, unknown>;
  const meta = pageMetaSchema.safeParse(input);
  if (!meta.success) return { ok: false, error: meta.error.issues[0]?.message ?? "Invalid page details" };
  if (isReservedSlug(meta.data.slug)) return { ok: false, error: `"/${meta.data.slug}" is used by the site itself. Choose another address.` };
  const value: Record<string, unknown> = {
    title: meta.data.title,
    slug: meta.data.slug,
    seo_title: meta.data.seo_title ?? null,
    meta_description: meta.data.meta_description ?? null,
    og_image_path: meta.data.og_image_path ?? null,
    noindex: meta.data.noindex,
  };
  if ("sections" in input) {
    const parsed = parseSections(input.sections);
    if (!parsed.ok) return parsed;
    value.sections = parsed.sections.map((section): Section => section.type === "html"
      ? { ...section, data: { ...section.data, html: sanitizeBlockHtml(section.data.html) } }
      : section);
  }
  return { ok: true, value };
}
