import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";

const schema = z.object({ photo_ids: z.array(z.string().uuid()).max(500) });

// Persists image order: display_order follows the array (reorder_talent_photos, migration 015).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("media.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const { error } = await auth.context.supabase.rpc("reorder_talent_photos", { target_talent: id, photo_ids: parsed.data.photo_ids });
  if (error) return databaseError(error, "save the image order");
  return NextResponse.json({ ok: true });
}
