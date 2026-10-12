import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";
import { mediaPath } from "@/features/cms/blocks";

const optional = (max: number) => z.string().trim().max(max).optional().transform((value) => value || null);
const image = mediaPath.optional().or(z.literal("")).transform((value) => value || null);

const schema = z.object({
  contact_email: z.string().trim().email("Enter a valid contact email").max(200),
  contact_phone: optional(40),
  instagram_url: z.string().trim().max(300).regex(/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._/-]+$/, "Use a link like https://instagram.com/42modelmanagement").optional().or(z.literal("")).transform((value) => value || null),
  location_line: optional(120),
  contact_heading: optional(120),
  home_hero: z.object({ eyebrow: optional(80), headline: z.string().trim().min(1, "The home page needs a headline").max(120), text: optional(400), image_path: image }),
  home_about: z.object({ eyebrow: optional(80), headline: z.string().trim().min(1, "Add an About headline").max(120), text: optional(800), image_path: image }),
});

export async function PUT(request: Request) {
  const auth = await requireApi("website.manage");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase, user } = auth.context;
  refreshPublicSite();
  const rows = Object.entries(parsed.data).map(([key, value]) => ({ key, value: value ?? null, is_public: true, updated_by: user.id }));
  const { error } = await supabase.from("website_settings").upsert(rows, { onConflict: "key" });
  if (error) return databaseError(error, "save the settings");
  await writeAudit(supabase, { action: "cms.settings_updated", entityType: "website", metadata: { keys: Object.keys(parsed.data) } });
  return NextResponse.json({ ok: true });
}
