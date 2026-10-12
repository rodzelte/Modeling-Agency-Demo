import { NextResponse } from "next/server";
import { requireApi } from "@/lib/agency-auth";
import { writeAudit } from "@/lib/api";
import { log } from "@/lib/log";
import { renderCompCard } from "@/features/compcard/build";

export const maxDuration = 60;

// GET ?photos=<id>,<id>…&measurements=1 → PDF comp card (approved material only).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi(["talent.view", "media.view"]);
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const photoIds = (url.searchParams.get("photos") ?? "").split(",").filter((value) => /^[0-9a-f-]{36}$/i.test(value)).slice(0, 5);
  try {
    const result = await renderCompCard(auth.context.supabase, id, { photoIds, measurements: url.searchParams.get("measurements") !== "0" });
    if (!result) return NextResponse.json({ error: "Talent not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 422 });
    await writeAudit(auth.context.supabase, { action: "compcard.generated", entityType: "talent", entityId: id, metadata: { photos: photoIds.length } });
    const filename = `${result.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "talent"}-comp-card.pdf`;
    return new NextResponse(new Uint8Array(result.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    log.error("compcard", "render failed", error, { talent: id });
    return NextResponse.json({ error: "The comp card could not be generated." }, { status: 500 });
  }
}
