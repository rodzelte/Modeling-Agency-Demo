import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApi } from "@/lib/agency-auth";
import { databaseError } from "@/lib/api";
import { CUSTOM_TARGETS } from "@/features/ghl/fields";
import { CRM_STATUSES } from "@/features/ghl/status";

// Mapping and settings edits. These run under the caller's own session: RLS
// (integrations.manage) and column grants decide, and database triggers audit
// every change. Only configuration is editable here, never mirrored GHL data.
const status = z.enum(CRM_STATUSES);
const target = z.enum(Object.keys(CUSTOM_TARGETS) as [keyof typeof CUSTOM_TARGETS, ...(keyof typeof CUSTOM_TARGETS)[]]);
const ghlId = z.string().min(1).max(100);

const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pipeline"), id: ghlId, purpose: z.enum(["talent", "client", "ignore"]).nullable(), badge_label: z.string().trim().max(30).nullable() }),
  z.object({ type: z.literal("stage"), id: ghlId, normalized_status: status.nullable() }),
  z.object({ type: z.literal("field"), id: ghlId, target: target.nullable(), ownership: z.enum(["ghl_only", "dashboard_only", "bidirectional"]) }),
  z.object({ type: z.literal("field_reviewed"), ids: z.array(ghlId).min(1).max(500) }),
  z.object({ type: z.literal("settings"), talent_statuses: z.array(status).max(CRM_STATUSES.length), writeback_enabled: z.boolean() }),
  z.object({ type: z.literal("rule_add"), kind: z.enum(["tag", "contact_field"]), field_id: ghlId.nullable(), match_value: z.string().trim().min(1).max(200), normalized_status: status }),
  z.object({ type: z.literal("rule_delete"), id: z.string().uuid() }),
]);

export async function PATCH(request: Request) {
  const auth = await requireApi("integrations.manage");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { supabase } = auth.context;
  const input = parsed.data;
  const now = new Date().toISOString();

  let result: { error: { message?: string; code?: string } | null; data?: unknown[] | null };
  switch (input.type) {
    case "pipeline":
      result = await supabase.from("ghl_pipelines").update({ purpose: input.purpose, badge_label: input.badge_label || null, updated_at: now }).eq("id", input.id).select("id");
      break;
    case "stage":
      result = await supabase.from("ghl_pipeline_stages").update({ normalized_status: input.normalized_status, updated_at: now }).eq("id", input.id).select("id");
      break;
    case "field":
      if (input.target === null && input.ownership !== "ghl_only") return NextResponse.json({ error: "An unmapped field can only be GHL-only" }, { status: 400 });
      result = await supabase.from("ghl_field_definitions").update({ target: input.target, ownership: input.ownership, reviewed_at: now, updated_at: now }).eq("id", input.id).select("id");
      break;
    case "field_reviewed":
      result = await supabase.from("ghl_field_definitions").update({ reviewed_at: now, updated_at: now }).in("id", input.ids).is("reviewed_at", null).select("id");
      return result.error ? databaseError(result.error, "update fields") : NextResponse.json({ updated: result.data?.length ?? 0 });
    case "settings":
      result = await supabase.from("ghl_settings").update({ talent_statuses: input.talent_statuses, writeback_enabled: input.writeback_enabled, updated_at: now }).eq("id", true).select("id");
      break;
    case "rule_add":
      if ((input.kind === "tag") !== (input.field_id === null)) return NextResponse.json({ error: "Field rules need a field; tag rules must not have one" }, { status: 400 });
      result = await supabase.from("ghl_status_rules").insert({ kind: input.kind, field_id: input.field_id, match_value: input.match_value, normalized_status: input.normalized_status }).select("id");
      if (result.error?.code === "23505") return NextResponse.json({ error: "That rule already exists" }, { status: 409 });
      break;
    case "rule_delete":
      result = await supabase.from("ghl_status_rules").delete().eq("id", input.id).select("id");
      break;
  }
  if (result.error) return databaseError(result.error, "save the GHL setting");
  if (!result.data?.length) return NextResponse.json({ error: "Not found, or you do not have permission" }, { status: 404 });
  return NextResponse.json({ ok: true, note: "Statuses are recalculated on the next sync. Use Run sync now to apply immediately." });
}
