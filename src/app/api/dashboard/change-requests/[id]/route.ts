import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";

const schema = z.object({ approve: z.boolean(), note: z.string().trim().max(1000).optional() });

// Approve (applies the change) or reject a talent's change request. The database
// checks the reviewer's permission for that kind of change and audits it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("talent.view");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  refreshPublicSite();
  const { error } = await auth.context.supabase.rpc("apply_change_request", { p_request_id: id, p_approve: parsed.data.approve, p_note: parsed.data.note ?? null });
  if (error?.code === "42501") return NextResponse.json({ error: "You do not have permission to review this request" }, { status: 403 });
  if (error?.code === "22023") return NextResponse.json({ error: error.message }, { status: 409 });
  if (error) return databaseError(error, "review the request");
  return NextResponse.json({ ok: true });
}
