import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { convertApplication } from "@/features/applications/convert";

// Converts approved applications into draft talent records, a batch at a time
// (photo copies are slow); the dashboard calls again until nothing remains.
// Same rules as converting one: the caller's session, drafts only, nothing published.
export const maxDuration = 60;
const BATCH = 8;

export async function POST() {
  const auth = await requireApi(["applications.manage", "talent.create", "talent.private.edit"]);
  if ("response" in auth) return auth.response;
  const { supabase, permissions } = auth.context;

  const { data, error } = await supabase.from("applications").select("id").eq("status", "approved").order("submitted_at").limit(BATCH);
  if (error) return databaseError(error, "load approved applications");

  let converted = 0;
  let failed = 0;
  let photos = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    const result = await convertApplication(supabase, id, permissions.has("media.manage"));
    if (result.ok) { converted += 1; photos += result.photosCopied; continue; }
    failed += 1;
    log.warn("applications", "bulk convert failed", { application: id, error: result.error.message });
  }

  const { count } = await supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "approved");
  // A failed conversion stays approved, so stop rather than retry it forever.
  return NextResponse.json({ converted, failed, photos_copied: photos, remaining: failed ? 0 : count ?? 0 });
}
