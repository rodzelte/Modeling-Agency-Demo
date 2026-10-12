import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue, optionalText } from "@/lib/validation";

const uuidOrNull = z.string().trim().refine((value) => value === "" || /^[0-9a-f-]{36}$/i.test(value)).transform((value) => value || null).nullable().optional();
const schema = z.object({
  title: z.string().trim().min(1, "Give the package a title").max(160),
  message: optionalText(4000),
  company_id: uuidOrNull,
  contact_id: uuidOrNull,
  show_measurements: z.boolean().default(true),
  items: z.array(z.object({ talent_id: z.string().uuid(), note: optionalText(600) })).max(100),
});

// Saves the package and replaces its talent list in the given order.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("packages.manage");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase } = auth.context;
  const { items, ...fields } = parsed.data;
  const { data, error } = await supabase.from("packages").update(fields).eq("id", id).select("id").maybeSingle();
  if (error) return databaseError(error, "save the package");
  if (!data) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  const { error: clearError } = await supabase.from("package_items").delete().eq("package_id", id);
  if (clearError) return databaseError(clearError, "update the package's talent");
  if (items.length) {
    const unique = items.filter((item, index) => items.findIndex((other) => other.talent_id === item.talent_id) === index);
    const { error: itemsError } = await supabase.from("package_items").insert(unique.map((item, index) => ({ package_id: id, talent_id: item.talent_id, note: item.note ?? null, sort_order: index })));
    if (itemsError) return databaseError(itemsError, "update the package's talent");
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("packages.manage");
  if ("response" in auth) return auth.response;
  const { error } = await auth.context.supabase.from("packages").delete().eq("id", id);
  if (error) return databaseError(error, "delete the package");
  return NextResponse.json({ ok: true });
}
