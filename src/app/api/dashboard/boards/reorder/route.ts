import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { reorderSchema } from "@/features/boards/schemas";
import { refreshPublicSite } from "@/features/public/cache";

// Saves sibling order: sort_order follows the array (reorder_boards, migration 013).
export async function POST(request: Request) {
  const auth = await requireApi("boards.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = reorderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { error } = await auth.context.supabase.rpc("reorder_boards", { board_ids: parsed.data.board_ids });
  if (error) return databaseError(error, "save the board order");
  return NextResponse.json({ ok: true });
}
