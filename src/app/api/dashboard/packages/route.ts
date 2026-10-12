import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";

const schema = z.object({ title: z.string().trim().min(1, "Give the package a title").max(160), talent_ids: z.array(z.string().uuid()).max(100).optional() });

export async function POST(request: Request) {
  const auth = await requireApi("packages.manage");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase } = auth.context;
  const { data, error } = await supabase.from("packages").insert({ title: parsed.data.title }).select("id").single();
  if (error) return databaseError(error, "create the package");
  if (parsed.data.talent_ids?.length) {
    const { error: itemsError } = await supabase.from("package_items").insert(parsed.data.talent_ids.map((talent_id, index) => ({ package_id: data.id, talent_id, sort_order: index })));
    if (itemsError) return databaseError(itemsError, "add talent to the package");
  }
  return NextResponse.json(data, { status: 201 });
}
