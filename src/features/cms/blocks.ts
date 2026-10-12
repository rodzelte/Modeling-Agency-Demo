import { z } from "zod";

// CMS page sections. Each section is { id, type, data }, stored as JSON on the
// page and validated here on every save, so the renderer can trust its shape.
// Pure module: used by the editor (client) and the API/renderer (server).

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional().transform((value) => value || undefined);
// Internal paths, https links, and mailto only: never javascript: or data: URLs.
export const safeHref = z.string().trim().max(500).regex(/^(\/(?![/\\])[A-Za-z0-9/_#?=&.%-]*|https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+)$/, "Use a path like /models, an https:// link, or mailto:");
const optionalHref = safeHref.optional().or(z.literal("").transform(() => undefined));
// Paths inside the public cms-media bucket.
export const mediaPath = z.string().trim().max(300).regex(/^cms\/[A-Za-z0-9/_.-]+\.(jpe?g|png|webp|mp4)$/i, "Choose an image from the media library");
const optionalMedia = mediaPath.optional().or(z.literal("").transform(() => undefined));
const boardPath = z.string().trim().max(200).regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/).optional().or(z.literal("").transform(() => undefined));

export const blockSchemas = {
  hero: z.object({
    eyebrow: optionalText(80), heading: text(160).min(1, "Add a heading"), text: optionalText(600), image_path: optionalMedia,
    cta_label: optionalText(40), cta_href: optionalHref, theme: z.enum(["dark", "light"]).default("dark"),
  }),
  rich_text: z.object({ heading: optionalText(160), body: text(20000).min(1, "Add some text") }),
  image: z.object({ image_path: mediaPath, alt: text(240).min(1, "Describe the image for screen readers"), caption: optionalText(240), width: z.enum(["normal", "wide", "full"]).default("wide") }),
  video: z.object({ url: z.string().trim().max(300).regex(/^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/)[A-Za-z0-9_-]+/, "Use a YouTube or Vimeo link"), title: optionalText(160) }),
  cta: z.object({ heading: text(160).min(1, "Add a heading"), text: optionalText(600), label: text(40).min(1, "Add a button label"), href: safeHref, theme: z.enum(["dark", "light"]).default("light") }),
  talent_grid: z.object({
    heading: optionalText(160), board: boardPath, featured_only: z.boolean().default(false), limit: z.coerce.number().int().min(1).max(24).default(8),
    sort: z.enum(["featured", "name", "newest"]).default("featured"), show_link: z.boolean().default(true),
  }),
  board_grid: z.object({ heading: optionalText(160), parent: boardPath }),
  contact: z.object({ heading: optionalText(160), text: optionalText(600) }),
  html: z.object({ html: text(50000).min(1, "Add some HTML"), css: optionalText(20000) }),
} as const;

export type BlockType = keyof typeof blockSchemas;
export type BlockData<T extends BlockType> = z.output<(typeof blockSchemas)[T]>;
export type Section = { [T in BlockType]: { id: string; type: T; data: BlockData<T> } }[BlockType];

export const BLOCK_LABELS: Record<BlockType, { label: string; hint: string }> = {
  hero: { label: "Hero", hint: "Large heading with an optional background image and button" },
  rich_text: { label: "Text", hint: "Headings, paragraphs, lists and links (Markdown)" },
  image: { label: "Image", hint: "One image with alt text and caption" },
  video: { label: "Video", hint: "YouTube or Vimeo embed" },
  cta: { label: "Call to action", hint: "Heading, short text and a button" },
  talent_grid: { label: "Talent grid", hint: "Published talent from a board, updated automatically" },
  board_grid: { label: "Board grid", hint: "Links to public boards" },
  contact: { label: "Contact details", hint: "Agency email, phone and Instagram from Settings" },
  html: { label: "Custom HTML", hint: "Advanced: sanitised HTML with scoped CSS; scripts are removed" },
};

export const BLOCK_DEFAULTS: { [T in BlockType]: z.input<(typeof blockSchemas)[T]> } = {
  hero: { heading: "New heading", theme: "dark" },
  rich_text: { body: "Write something…" },
  image: { image_path: "", alt: "" },
  video: { url: "" },
  cta: { heading: "Work with 42", label: "Get in touch", href: "/#contact", theme: "light" },
  talent_grid: { heading: "Talent", limit: 8, sort: "featured", featured_only: false, show_link: true },
  board_grid: { heading: "Boards" },
  contact: { heading: "Contact" },
  html: { html: "<p>Custom content</p>" },
};

const sectionSchema = z.object({ id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/), type: z.enum(Object.keys(blockSchemas) as [BlockType, ...BlockType[]]), data: z.unknown() });

// Validates every section; returns the cleaned list or the first readable error.
export function parseSections(input: unknown): { ok: true; sections: Section[] } | { ok: false; error: string } {
  const list = z.array(sectionSchema).max(60, "A page can have at most 60 sections").safeParse(input);
  if (!list.success) return { ok: false, error: "The page sections are not in the expected format." };
  const ids = new Set<string>();
  const sections: Section[] = [];
  for (const [index, section] of list.data.entries()) {
    if (ids.has(section.id)) return { ok: false, error: `Section ${index + 1} has a duplicate id.` };
    ids.add(section.id);
    const parsed = blockSchemas[section.type].safeParse(section.data ?? {});
    if (!parsed.success) return { ok: false, error: `${BLOCK_LABELS[section.type].label} (section ${index + 1}): ${parsed.error.issues[0]?.message ?? "invalid"}` };
    sections.push({ id: section.id, type: section.type, data: parsed.data } as Section);
  }
  return { ok: true, sections };
}

export const pageMetaSchema = z.object({
  title: text(160).min(1, "Add a page title"),
  slug: z.string().trim().toLowerCase().max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/, "Use lowercase words separated by hyphens, e.g. about or services/castings"),
  seo_title: optionalText(160),
  meta_description: optionalText(320),
  og_image_path: optionalMedia,
  noindex: z.boolean().default(false),
});

// Paths the CMS may not claim because the app already serves them.
export const RESERVED_SLUGS = ["models", "dashboard", "portal", "preview", "login", "auth", "api", "join", "p", "sitemap.xml", "robots.txt"];
export function isReservedSlug(slug: string) {
  return RESERVED_SLUGS.includes(slug.split("/")[0]);
}

export function videoEmbed(url: string) {
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
  if (youtube) return `https://www.youtube-nocookie.com/embed/${youtube[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d{4,15})/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}?dnt=1`;
  return null;
}
