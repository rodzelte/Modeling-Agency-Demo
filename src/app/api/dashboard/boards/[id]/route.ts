import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { boardSchema } from "@/features/boards/schemas";
import { refreshPublicSite } from "@/features/public/cache";

// Edits a board. Deactivating or unpublishing hides it from the website; talent and
// their assignments are never deleted by board changes.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("boards.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = boardSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  if (parsed.data.parent_board_id === id) return NextResponse.json({ error: "A board cannot be nested inside itself" }, { status: 400 });

  const { data, error } = await auth.context.supabase.from("boards").update(definedOnly(parsed.data)).eq("id", id).select("id").maybeSingle();
  if (error?.code === "23505") return NextResponse.json({ error: "That slug or URL segment is already used by another board at this level" }, { status: 409 });
  if (error?.code === "P0001") return NextResponse.json({ error: error.message }, { status: 400 });
  if (error) return databaseError(error, "update the board");
  if (!data) return NextResponse.json({ error: "Board not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
