import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError, writeAudit } from "@/lib/api";
import { firstIssue } from "@/lib/validation";
import { requireEntitledPortalApi } from "@/features/portal/context";

const schema = z.object({
  storage_path: z.string().trim().max(300),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  file_size: z.number().int().min(1).max(25 * 1024 * 1024),
  original_file_name: z.string().trim().max(200).optional(),
});

// Records a digital the talent uploaded to their portal folder. It waits for
// staff review and can never be made public before approval (database rule).
export async function POST(request: Request) {
  const auth = await requireEntitledPortalApi();
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase, profile } = auth.portal;
  if (!parsed.data.storage_path.startsWith(`talent/${profile.id}/portal/`)) return NextResponse.json({ error: "Invalid upload path" }, { status: 400 });
  const { error } = await supabase.from("talent_photos").insert({
    talent_id: profile.id, storage_path: parsed.data.storage_path, storage_bucket: "talent-private", public: false,
    uploaded_by_talent: true, review_status: "pending", image_type: "digital", title: "Digital from talent",
    mime_type: parsed.data.mime_type, file_size: parsed.data.file_size, original_file_name: parsed.data.original_file_name ?? null,
  });
  if (error) return databaseError(error, "save the digital");
  await writeAudit(supabase, { action: "portal.digital_uploaded", entityType: "talent", entityId: profile.id }).catch(() => undefined);
  return NextResponse.json({ ok: true }, { status: 201 });
}
