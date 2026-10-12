import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";

const schema = z.object({ photo_id: z.string().uuid() });

// Sets the primary image; set_featured_photo clears every other featured flag.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("media.manage");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const { supabase } = auth.context;
  const { error } = await supabase.rpc("set_featured_photo", { target_talent: id, photo: parsed.data.photo_id });
  if (error) return databaseError(error, "set the primary image");
  await writeAudit(supabase, { action: "media.primary_set", entityType: "talent", entityId: id, metadata: { photo_id: parsed.data.photo_id } });
  return NextResponse.json({ ok: true });
}
