import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue, optionalText } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";

const schema = z.object({
  kind: z.enum(["portfolio", "book"]),
  name: z.string().trim().min(1).max(120).optional(),
  description: optionalText(1000),
  public: z.boolean().optional(),
  is_default: z.boolean().optional(),
  photo_ids: z.array(z.string().uuid()).max(300).optional(),
});

const tables = { portfolio: "portfolios", book: "digital_books" } as const;

// Edits a portfolio / digital book. photo_ids replaces its contents in that order.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; collectionId: string }> }) {
  const { id, collectionId } = await params;
  const auth = await requireApi("media.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase } = auth.context;
  const { kind, photo_ids, ...fields } = parsed.data;
  const update = definedOnly(kind === "book" ? { name: fields.name, public: fields.public } : fields);

  if (kind === "portfolio" && update.is_default) await supabase.from("portfolios").update({ is_default: false }).eq("talent_id", id).neq("id", collectionId);
  if (Object.keys(update).length) {
    const { data, error } = await supabase.from(tables[kind]).update(update).eq("id", collectionId).eq("talent_id", id).select("id").maybeSingle();
    if (error) return databaseError(error, "update the collection");
    if (!data) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }
  if (photo_ids) {
    const { error } = await supabase.rpc(kind === "portfolio" ? "set_portfolio_images" : "set_digital_book_images",
      kind === "portfolio" ? { target_portfolio: collectionId, photo_ids } : { target_book: collectionId, photo_ids });
    if (error) return databaseError(error, "save the selected images");
  }
  await writeAudit(supabase, { action: `${kind === "portfolio" ? "portfolio" : "digital_book"}.updated`, entityType: "talent", entityId: id, metadata: { collection_id: collectionId, fields: [...Object.keys(update), ...(photo_ids ? ["images"] : [])] } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; collectionId: string }> }) {
  const { id, collectionId } = await params;
  const auth = await requireApi("media.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const kind = new URL(request.url).searchParams.get("kind") === "book" ? "book" : "portfolio";
  const { supabase } = auth.context;
  // Removes the collection only; its photos stay in the talent's library.
  const { error } = await supabase.from(tables[kind]).delete().eq("id", collectionId).eq("talent_id", id);
  if (error) return databaseError(error, "delete the collection");
  await writeAudit(supabase, { action: `${kind === "portfolio" ? "portfolio" : "digital_book"}.deleted`, entityType: "talent", entityId: id, metadata: { collection_id: collectionId } });
  return NextResponse.json({ ok: true });
}
