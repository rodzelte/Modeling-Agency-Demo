import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue, slugify } from "@/lib/validation";
import { boardSchema } from "@/features/boards/schemas";
import { refreshPublicSite } from "@/features/public/cache";

// Creates a board. The database validates slugs, prevents cycles, and audits the change.
export async function POST(request: Request) {
  const auth = await requireApi("boards.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = boardSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  if (!parsed.data.name) return NextResponse.json({ error: "A board name is required" }, { status: 400 });

  const { supabase } = auth.context;
  const values = definedOnly(parsed.data);
  const segment = values.path_segment || slugify(values.name!.split("/").pop() ?? values.name!);
  const { count } = await supabase.from("boards").select("id", { count: "exact", head: true })
    .filter("parent_board_id", values.parent_board_id ? "eq" : "is", values.parent_board_id ?? null);
  const { data, error } = await supabase.from("boards").insert({
    ...values,
    slug: values.slug || slugify(values.name!),
    path_segment: segment,
    sort_order: count ?? 0,
    display_order: count ?? 0,
  }).select("id").single();
  if (error?.code === "23505") return NextResponse.json({ error: "That slug or URL segment is already used by another board at this level" }, { status: 409 });
  if (error?.code === "P0001") return NextResponse.json({ error: error.message }, { status: 400 });
  if (error) return databaseError(error, "create the board");
  return NextResponse.json(data, { status: 201 });
}
