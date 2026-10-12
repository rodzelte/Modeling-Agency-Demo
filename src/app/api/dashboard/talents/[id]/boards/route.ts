import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";

const schema = z.object({ board_id: z.string().uuid() });

// Assign / unassign a board. The database audits both (board.assigned / board.removed).
async function change(request: Request, { params }: { params: Promise<{ id: string }> }, assign: boolean) {
  const { id } = await params;
  const auth = await requireApi("boards.assign");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase } = auth.context;

  if (assign) {
    const { error } = await supabase.from("talent_board_assignments").insert({ talent_id: id, board_id: parsed.data.board_id });
    if (error?.code === "23505") return NextResponse.json({ ok: true });
    if (error) return databaseError(error, "assign the board");
  } else {
    const { error } = await supabase.from("talent_board_assignments").delete().eq("talent_id", id).eq("board_id", parsed.data.board_id);
    if (error) return databaseError(error, "remove the board");
  }
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return change(request, context, true);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return change(request, context, false);
}
