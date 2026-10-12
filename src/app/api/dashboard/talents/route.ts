import { NextResponse } from "next/server";
import { databaseError, writeAudit } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue, slugify } from "@/lib/validation";
import { createTalentSchema } from "@/features/talent/schemas";
import { refreshPublicSite } from "@/features/public/cache";

export async function POST(request: Request) {
  const auth = await requireApi("talent.create");
  if ("response" in auth) return auth.response;
  refreshPublicSite();
  const { supabase, permissions } = auth.context;

  const parsed = createTalentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { first_name, last_name, display_name, gender, location, is_minor, date_of_birth, board_ids = [] } = parsed.data;

  const name = display_name || [first_name, last_name].filter(Boolean).join(" ");
  const suffix = crypto.randomUUID().slice(0, 6);
  const { data: talent, error } = await supabase.from("talent").insert({
    slug: `${slugify(name) || "talent"}-${suffix}`,
    talent_id: `T-${suffix.toUpperCase()}`,
    first_name,
    last_name: last_name ?? "",
    display_name: name,
    gender: gender ?? null,
    location: location ?? null,
    is_minor: is_minor ?? false,
    guardian_required: is_minor ?? false,
    consent_status: is_minor ? "pending" : "not_required",
    publication_status: "draft",
    show_on_website: false,
  }).select("id,slug").single();
  if (error || !talent) return databaseError(error, "create talent");

  if (permissions.has("talent.private.edit")) {
    const { error: privateError } = await supabase.from("talent_private_details").insert({ talent_id: talent.id, date_of_birth: date_of_birth ?? null });
    if (privateError) return databaseError(privateError, "save private details");
  }

  if (board_ids.length && permissions.has("boards.assign")) {
    const { error: boardError } = await supabase.from("talent_board_assignments").insert(board_ids.map((board_id) => ({ talent_id: talent.id, board_id })));
    if (boardError) return databaseError(boardError, "assign boards");
  }

  await writeAudit(supabase, { action: "talent.created", entityType: "talent", entityId: talent.id, metadata: { slug: talent.slug, boards: board_ids.length } });
  return NextResponse.json(talent, { status: 201 });
}
