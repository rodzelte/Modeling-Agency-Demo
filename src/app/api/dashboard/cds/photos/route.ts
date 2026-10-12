import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { copyPhotos, finishTalentPhotos, planPhotos } from "@/features/cds/photos";
import { refreshPublicSite } from "@/features/public/cache";

// "4. Copy photos" in Dashboard → CDS Import (see features/cds/photos.ts):
//   { plan: true }                  → what to copy per talent (and mark the rest skipped)
//   { photos: [{ id, url }] }       → copy these (signed CDS bucket links, max 6)
//   { finish: wffId }               → cover, portfolios, digitals, public copies
export const maxDuration = 60;

const id = z.string().regex(/^\d{1,15}$/);
const bodySchema = z.union([
  z.object({ plan: z.literal(true) }),
  z.object({ photos: z.array(z.object({ id, url: z.url().max(4000) })).min(1).max(6) }),
  z.object({ finish: id }),
]);

export async function POST(request: Request) {
  const auth = await requireApi(["integrations.manage", "media.manage"]);
  if ("response" in auth) return auth.response;
  const { supabase } = auth.context;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  try {
    if ("plan" in parsed.data) return NextResponse.json(await planPhotos(supabase));
    if ("photos" in parsed.data) return NextResponse.json(await copyPhotos(supabase, parsed.data.photos));
    const result = await finishTalentPhotos(supabase, parsed.data.finish);
    if (result.published) refreshPublicSite();
    return NextResponse.json(result);
  } catch (error) {
    return databaseError(error as { message?: string }, "copy the CDS photos");
  }
}
