import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { isExcludedName } from "@/features/cds/logic";
import { cdsIngestSchema, type WffTalentPayload } from "@/features/cds/schema";

// Stores data handed over by Dashboard → CDS Import in the staging tables
// (migration 029). It never touches the dashboard's own talent records; "Add new
// talents" does that separately. Re-sending refreshes the staging data without
// losing links or import status.
//   talents: CDS General data, keyed by CDS Talent ID
//   wff:     WebForFashion boards, stats, skills, portfolios and media, joined to
//            the CDS record by WebForFashion id, then email, then exact name
export async function POST(request: Request) {
  const auth = await requireApi("integrations.manage");
  if ("response" in auth) return auth.response;
  const { supabase } = auth.context;

  const parsed = cdsIngestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const now = new Date().toISOString();
  const result = { talents: 0, excluded: 0, wff: 0, media: 0, unmatched: [] as string[] };

  for (const talent of parsed.data.talents ?? []) {
    const excluded = isExcludedName(talent.first_name, talent.last_name);
    const { data: existing, error: loadError } = await supabase.from("cds_talents").select("match_status,profile").eq("cds_id", talent.cds_id).maybeSingle();
    if (loadError) return databaseError(loadError, "load the CDS talent");
    const { error } = await supabase.from("cds_talents").upsert({
      cds_id: talent.cds_id, first_name: talent.first_name, last_name: talent.last_name, email: talent.email, phone: talent.phone,
      gender: talent.gender, location: talent.location,
      profile: { ...(existing?.profile ?? {}), ...talent.profile },
      excluded,
      ...(excluded ? { match_status: "skipped", match_reason: "Agency placeholder record" } : existing ? {} : { match_status: "pending" }),
      extracted_at: now, updated_at: now,
    }, { onConflict: "cds_id" });
    if (error) return databaseError(error, "save the CDS talent");
    result.talents += 1;
    if (excluded) result.excluded += 1;
  }

  for (const wff of parsed.data.wff ?? []) {
    const target = await findCdsRecord(supabase, wff);
    if (!target) { result.unmatched.push(`${wff.first_name} ${wff.last_name}`.trim()); continue; }
    const { error } = await supabase.from("cds_talents").update({
      wff_id: wff.wff_id,
      cds_boards: wff.cds_boards,
      portfolios: wff.portfolios,
      profile: { ...target.profile, stats: wff.profile.stats, skills: wff.profile.skills, date_of_birth: target.profile.date_of_birth ?? wff.profile.date_of_birth },
      email: target.email ?? wff.emails[0] ?? null,
      phone: target.phone ?? wff.phones[0] ?? null,
      extracted_at: now, updated_at: now,
    }).eq("cds_id", target.cds_id);
    if (error) return databaseError(error, "save the WebForFashion data");
    result.wff += 1;
    if (target.excluded) continue;

    // One row per media item; an id seen in two lists keeps its first kind.
    const seen = new Set<string>();
    const rows = wff.media.filter((item) => !seen.has(item.id) && seen.add(item.id)).map((item) => ({
      wff_media_id: item.id, cds_id: target.cds_id, kind: item.kind, position: item.position, metadata: item.metadata, extracted_at: now, updated_at: now,
    }));
    for (let start = 0; start < rows.length; start += 500) {
      const { error: mediaError } = await supabase.from("cds_media").upsert(rows.slice(start, start + 500), { onConflict: "wff_media_id" });
      if (mediaError) return databaseError(mediaError, "save the media list");
    }
    result.media += rows.length;
  }
  return NextResponse.json(result);
}

// ilike without wildcards: an exact, case-insensitive comparison.
const escape = (value: string) => value.replace(/[%_\\]/g, (c) => `\\${c}`);

type Target = { cds_id: string; email: string | null; phone: string | null; excluded: boolean; profile: Record<string, unknown> & { date_of_birth?: string | null } };

async function findCdsRecord(supabase: SupabaseClient, wff: WffTalentPayload): Promise<Target | null> {
  const columns = "cds_id,email,phone,excluded,profile,first_name,last_name,wff_id";
  const { data: byId } = await supabase.from("cds_talents").select(columns).eq("wff_id", wff.wff_id).maybeSingle();
  if (byId) return byId as Target;
  const free = (rows: { wff_id: string | null }[] | null) => (rows ?? []).filter((row) => !row.wff_id);
  for (const email of wff.emails) {
    const { data } = await supabase.from("cds_talents").select(columns).ilike("email", email.replace(/[%_\\]/g, (c) => `\\${c}`));
    const rows = free(data);
    if (rows.length === 1) return rows[0] as unknown as Target;
  }
  const { data } = await supabase.from("cds_talents").select(columns).ilike("first_name", escape(wff.first_name)).ilike("last_name", escape(wff.last_name));
  const rows = free(data);
  return rows.length === 1 ? rows[0] as unknown as Target : null;
}
