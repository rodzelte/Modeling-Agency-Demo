import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";
import { safeHref } from "@/features/cms/blocks";

const item = z.object({
  id: z.string().uuid().optional(),
  location: z.enum(["header", "footer"]),
  label: z.string().trim().min(1, "Every link needs a label").max(60),
  href: safeHref,
  is_visible: z.boolean().default(true),
});
const schema = z.object({ items: z.array(item).max(40) });

// Replaces the whole menu in one save; order follows the list.
export async function PUT(request: Request) {
  const auth = await requireApi("website.manage");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase } = auth.context;
  refreshPublicSite();

  const rows = parsed.data.items.map((entry, index) => ({ ...entry, sort_order: index }));
  const keep = rows.filter((row) => row.id).map((row) => row.id as string);
  const { data: existing, error: loadError } = await supabase.from("website_navigation").select("id");
  if (loadError) return databaseError(loadError, "load the menu");
  const remove = (existing ?? []).map((row: { id: string }) => row.id).filter((id) => !keep.includes(id));
  if (remove.length) {
    const { error } = await supabase.from("website_navigation").delete().in("id", remove);
    if (error) return databaseError(error, "update the menu");
  }
  for (const row of rows) {
    const { error } = row.id
      ? await supabase.from("website_navigation").update(row).eq("id", row.id)
      : await supabase.from("website_navigation").insert({ location: row.location, label: row.label, href: row.href, is_visible: row.is_visible, sort_order: row.sort_order });
    if (error) return databaseError(error, "save the menu");
  }
  return NextResponse.json({ ok: true });
}
