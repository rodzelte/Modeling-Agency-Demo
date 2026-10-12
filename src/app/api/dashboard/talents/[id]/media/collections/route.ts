import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue, optionalText, slugify } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";

const schema = z.object({
  kind: z.enum(["portfolio", "book"]),
  name: z.string().trim().min(1).max(120),
  description: optionalText(1000),
  public: z.boolean().optional(),
  is_default: z.boolean().optional(),
});

// Portfolios and digital books are per-talent collections of existing photos.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("media.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase } = auth.context;
  const { kind, name, description, public: isPublic, is_default } = parsed.data;

  const table = kind === "portfolio" ? "portfolios" : "digital_books";
  const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("talent_id", id);
  if (kind === "portfolio" && is_default) await supabase.from("portfolios").update({ is_default: false }).eq("talent_id", id);
  const row: Record<string, unknown> = kind === "portfolio"
    ? { talent_id: id, name, slug: slugify(name) || `portfolio-${(count ?? 0) + 1}`, description: description ?? null, public: isPublic ?? false, is_default: is_default ?? false, display_order: count ?? 0 }
    : { talent_id: id, name, public: isPublic ?? false, display_order: count ?? 0 };
  const { data, error } = await supabase.from(table).insert(row).select("id").single();
  if (error?.code === "23505") return NextResponse.json({ error: "A portfolio with that name already exists" }, { status: 409 });
  if (error) return databaseError(error, `create the ${kind === "portfolio" ? "portfolio" : "digital book"}`);
  await writeAudit(supabase, { action: `${kind === "portfolio" ? "portfolio" : "digital_book"}.created`, entityType: "talent", entityId: id, metadata: { collection_id: data.id } });
  return NextResponse.json(data, { status: 201 });
}
