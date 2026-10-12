import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { applyPendingTalents } from "@/features/cds/apply";
import { refreshPublicSite } from "@/features/public/cache";

// "Add new talents" in Dashboard → CDS Import: processes the next few pending CDS
// talents (the page calls it until nothing remains). See features/cds/apply.ts.
export const maxDuration = 60;

export async function POST() {
  const auth = await requireApi(["integrations.manage", "talent.create", "talent.private.edit", "boards.manage", "boards.assign", "measurements.edit", "skills.edit"]);
  if ("response" in auth) return auth.response;
  try {
    const result = await applyPendingTalents(auth.context.supabase);
    if (result.created || result.boardsCreated) refreshPublicSite();
    return NextResponse.json(result);
  } catch (error) {
    return databaseError(error as { message?: string }, "add the CDS talents");
  }
}
