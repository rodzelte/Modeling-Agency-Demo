import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/api";
import { log } from "@/lib/log";
import { slugify } from "@/lib/validation";
import { matchTalent, measurementRow, normalizeLocation, planPortfolioBoard, type BoardRef, type MatchCandidate } from "./logic";
import type { StagedPortfolio, StagedProfile } from "./schema";

type StagedTalent = {
  cds_id: string; first_name: string; last_name: string; email: string | null; phone: string | null;
  gender: string | null; location: string | null; profile: StagedProfile; portfolios: StagedPortfolio[];
};

// "Add new talents": for each pending CDS talent whose WebForFashion data has
// arrived (boards, stats and portfolios come from there), link it to the dashboard talent
// it already is (email, phone or unique name; existing records are NOT changed),
// send uncertain cases to review, and create a draft talent for everyone else,
// with private details, measurements, skills and board placement from the CDS
// portfolios. Missing boards are created unpublished. Runs as the signed-in owner,
// so RLS and the usual triggers and audit apply. Photos are imported separately.
export async function applyPendingTalents(supabase: SupabaseClient, limit = 8) {
  const { data: pending, error } = await supabase.from("cds_talents")
    .select("cds_id,first_name,last_name,email,phone,gender,location,profile,portfolios")
    .eq("match_status", "pending").eq("excluded", false).is("talent_id", null).not("wff_id", "is", null)
    .order("last_name").order("first_name").limit(limit);
  if (error) throw error;
  const batch = (pending ?? []) as StagedTalent[];
  const result = { matched: 0, created: 0, review: 0, boardsCreated: 0, repaired: 0 };
  if (!batch.length) {
    result.repaired = await repairMeasurements(supabase) + await repairLocations(supabase);
    return { ...result, remaining: 0 };
  }

  const boardFor = await ensurePortfolioBoards(supabase, [...new Set(batch.flatMap((t) => t.portfolios.map((p) => p.name)))], result);
  const candidates = await loadCandidates(supabase);

  for (const staged of batch) {
    const match = matchTalent({ firstName: staged.first_name, lastName: staged.last_name, email: staged.email, phone: staged.phone, dateOfBirth: staged.profile.date_of_birth }, candidates);
    if (match.kind === "match") {
      await stage(supabase, staged.cds_id, { talent_id: match.id, match_status: "matched", match_reason: `Matched by ${match.reason}` });
      candidates.splice(candidates.findIndex((c) => c.id === match.id), 1);
      result.matched += 1;
      continue;
    }
    if (match.kind === "review") {
      await stage(supabase, staged.cds_id, { match_status: "review", match_reason: match.reason });
      result.review += 1;
      continue;
    }
    const created = await createTalent(supabase, staged, boardFor);
    await stage(supabase, staged.cds_id, created.id
      ? { talent_id: created.id, match_status: "created", match_reason: created.problem ? `Created; ${created.problem}` : "Created from CDS" }
      : { match_status: "review", match_reason: created.problem ?? "Could not be created" });
    if (created.id) result.created += 1; else result.review += 1;
  }

  const { count } = await supabase.from("cds_talents").select("cds_id", { count: "exact", head: true })
    .eq("match_status", "pending").eq("excluded", false).is("talent_id", null).not("wff_id", "is", null);
  return { ...result, remaining: count ?? 0 };
}

// Talents created while a step failed ("Created; missing measurements") get the
// missing measurements on the next run, once; nothing else is touched.
async function repairMeasurements(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("cds_talents").select("cds_id,talent_id,profile,match_reason")
    .eq("match_status", "created").ilike("match_reason", "%missing%measurements%").not("talent_id", "is", null).limit(50);
  if (error) throw error;
  let repaired = 0;
  for (const row of data ?? []) {
    const { count } = await supabase.from("talent_measurements").select("id", { count: "exact", head: true }).eq("talent_id", row.talent_id).eq("source", "cds");
    const measurements = measurementRow((row.profile as StagedProfile).stats ?? {});
    if (!count && measurements) {
      const { error: insertError } = await supabase.from("talent_measurements").insert({ ...measurements, talent_id: row.talent_id, is_official: true, source: "cds" });
      if (insertError) { log.error("cds", "measurements repair failed", insertError, { cds: row.cds_id }); continue; }
    }
    const rest = (row.match_reason as string).replace(/^Created; missing /, "").split(", ").filter((step) => step !== "measurements");
    await stage(supabase, row.cds_id, { match_reason: rest.length ? `Created; missing ${rest.join(", ")}` : "Created from CDS" });
    repaired += 1;
  }
  return repaired;
}

// Talents created before locations were normalised keep the raw CDS text
// ("Fort worth"). Tidy it only while the talent still holds exactly that text,
// so a location staff have since edited is never overwritten.
async function repairLocations(supabase: SupabaseClient) {
  const { data: staged, error } = await supabase.from("cds_talents").select("talent_id,location")
    .eq("match_status", "created").not("talent_id", "is", null).not("location", "is", null).limit(500);
  if (error) throw error;
  const raw = new Map((staged ?? []).map((row) => [row.talent_id as string, row.location as string]));
  if (!raw.size) return 0;
  const { data: talents, error: talentError } = await supabase.from("talent").select("id,location").in("id", [...raw.keys()]);
  if (talentError) throw talentError;
  let repaired = 0;
  for (const talent of talents ?? []) {
    const original = raw.get(talent.id);
    const tidy = normalizeLocation(original);
    // Same text apart from capitals (an earlier tidy-up) still counts as untouched.
    if ((talent.location ?? "").toLowerCase() !== (original ?? "").toLowerCase() || tidy === talent.location) continue;
    const { error: updateError } = await supabase.from("talent").update({ location: tidy }).eq("id", talent.id);
    if (updateError) { log.error("cds", "location repair failed", updateError, { talent: talent.id }); continue; }
    repaired += 1;
  }
  return repaired;
}

async function stage(supabase: SupabaseClient, cdsId: string, values: Record<string, unknown>) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("cds_talents").update({ ...values, applied_at: now, updated_at: now }).eq("cds_id", cdsId);
  if (error) throw error;
}

// Every non-archived dashboard talent not yet linked to a CDS record.
async function loadCandidates(supabase: SupabaseClient): Promise<MatchCandidate[]> {
  const [{ data: talents, error }, { data: details, error: detailsError }, { data: linked, error: linkedError }] = await Promise.all([
    supabase.from("talent").select("id,first_name,last_name").is("archived_at", null).limit(5000),
    supabase.from("talent_private_details").select("talent_id,email,mobile,phone,date_of_birth").limit(5000),
    supabase.from("cds_talents").select("talent_id").not("talent_id", "is", null).limit(5000),
  ]);
  if (error || detailsError || linkedError) throw error ?? detailsError ?? linkedError;
  const taken = new Set((linked ?? []).map((row) => row.talent_id as string));
  const byTalent = new Map((details ?? []).map((row) => [row.talent_id as string, row]));
  return (talents ?? []).filter((t) => !taken.has(t.id)).map((t) => {
    const d = byTalent.get(t.id);
    return { id: t.id, firstName: t.first_name ?? "", lastName: t.last_name ?? "", email: d?.email ?? null, phones: [d?.mobile ?? null, d?.phone ?? null], dateOfBirth: d?.date_of_birth ?? null };
  });
}

// Maps each CDS portfolio name to a website board, creating missing boards as
// unpublished drafts (owner decision 2026-10-05). Mappings are stored so the
// owner can change them later in the CDS Import page.
async function ensurePortfolioBoards(supabase: SupabaseClient, names: string[], result: { boardsCreated: number }) {
  const boardFor = new Map<string, string>();
  if (!names.length) return boardFor;
  const { data: mapped, error } = await supabase.from("cds_portfolio_boards").select("portfolio_name,board_id").in("portfolio_name", names);
  if (error) throw error;
  for (const row of mapped ?? []) if (row.board_id) boardFor.set(row.portfolio_name, row.board_id);
  const missing = names.filter((name) => !(mapped ?? []).some((row) => row.portfolio_name === name));
  if (!missing.length) return boardFor;

  const { data: boardRows, error: boardsError } = await supabase.from("boards").select("id,name,parent_board_id,path_segment");
  if (boardsError) throw boardsError;
  const boards: BoardRef[] = (boardRows ?? []).map((b) => ({ id: b.id, name: b.name, parentId: b.parent_board_id, segment: b.path_segment ?? "" }));

  const createBoard = async (name: string, parent: BoardRef | null) => {
    const segment = slugify(name.split("/").pop()!) || "board";
    const fullName = parent ? `${parent.name.split("/").pop()!.trim()} / ${name}` : name;
    const { count } = await supabase.from("boards").select("id", { count: "exact", head: true })
      .filter("parent_board_id", parent ? "eq" : "is", parent?.id ?? null);
    const { data, error: insertError } = await supabase.from("boards").insert({
      name: fullName, slug: slugify(fullName) || `board-${segment}`, path_segment: segment, parent_board_id: parent?.id ?? null,
      category: parent ? slugify(parent.name.split("/").pop()!) : segment, section: segment,
      is_active: true, publish_to_website: false, internal_only: false, show_in_navigation: true,
      sort_order: count ?? 0, display_order: count ?? 0,
    }).select("id,name,parent_board_id,path_segment").single();
    if (insertError || !data) throw insertError ?? new Error("board not created");
    result.boardsCreated += 1;
    const ref = { id: data.id, name: data.name, parentId: data.parent_board_id, segment: data.path_segment ?? segment };
    boards.push(ref);
    return ref;
  };

  for (const portfolio of missing) {
    const plan = planPortfolioBoard(portfolio, boards);
    let boardId: string;
    let source: "auto" | "created" = "auto";
    if (plan.kind === "existing") boardId = plan.boardId;
    else {
      let parent: BoardRef | null = null;
      if (plan.parentName) {
        parent = boards.find((b) => !b.parentId && b.name.split("/").pop()!.trim().toLowerCase() === plan.parentName!.toLowerCase()) ?? await createBoard(plan.parentName, null);
      }
      boardId = (await createBoard(plan.name, parent)).id;
      source = "created";
    }
    const { error: mapError } = await supabase.from("cds_portfolio_boards").upsert({ portfolio_name: portfolio, board_id: boardId, mapping_source: source, updated_at: new Date().toISOString() }, { onConflict: "portfolio_name" });
    if (mapError) throw mapError;
    boardFor.set(portfolio, boardId);
  }
  return boardFor;
}

function age(dateOfBirth: string | null) {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  const now = new Date();
  let years = now.getUTCFullYear() - born.getUTCFullYear();
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) years -= 1;
  return years;
}

async function createTalent(supabase: SupabaseClient, staged: StagedTalent, boardFor: Map<string, string>): Promise<{ id: string | null; problem?: string }> {
  const name = [staged.first_name, staged.last_name].filter(Boolean).join(" ").trim();
  if (!name) return { id: null, problem: "No name in CDS" };
  const years = age(staged.profile.date_of_birth);
  const minor = years !== null && years < 18;
  const suffix = crypto.randomUUID().slice(0, 6);
  const { data: talent, error } = await supabase.from("talent").insert({
    slug: `${slugify(name) || "talent"}-${suffix}`,
    talent_id: `CDS-${staged.cds_id}`,
    first_name: staged.first_name || name,
    last_name: staged.last_name ?? "",
    display_name: name,
    gender: staged.gender,
    location: normalizeLocation(staged.location),
    date_joined: staged.profile.date_joined,
    is_minor: minor,
    guardian_required: minor,
    consent_status: minor ? "pending" : "not_required",
    publication_status: "draft",
    show_on_website: false,
  }).select("id").single();
  if (error || !talent) {
    log.error("cds", "create talent failed", error, { cds: staged.cds_id });
    return { id: null, problem: "The talent record could not be created" };
  }

  // The talent exists from here on: later steps report problems but keep the link.
  const problems: string[] = [];
  const step = async (label: string, run: () => PromiseLike<{ error: unknown }>) => {
    const { error: stepError } = await run();
    if (stepError) { problems.push(label); log.error("cds", `${label} failed`, stepError, { cds: staged.cds_id }); }
  };
  await step("private details", () => supabase.from("talent_private_details").upsert({
    talent_id: talent.id, date_of_birth: staged.profile.date_of_birth, birth_place: staged.profile.birth_place,
    nationality: staged.profile.nationality, email: staged.email, mobile: staged.phone, website: staged.profile.website,
  }, { onConflict: "talent_id" }));
  const measurements = measurementRow(staged.profile.stats ?? {});
  if (measurements) await step("measurements", () => supabase.from("talent_measurements").insert({ ...measurements, talent_id: talent.id, is_official: true, source: "cds" }));
  const skills = staged.profile.skills ?? [];
  if (skills.length) {
    await step("skills", () => supabase.from("talent_skills").insert(skills.map((s) => ({ talent_id: talent.id, category: "CDS", skill: s.skill, level: s.level }))));
  }
  const boardIds = [...new Set(staged.portfolios.map((p) => boardFor.get(p.name)).filter((id): id is string => Boolean(id)))];
  if (boardIds.length) await step("boards", () => supabase.from("talent_board_assignments").insert(boardIds.map((board_id) => ({ talent_id: talent.id, board_id }))));

  await writeAudit(supabase, { action: "talent.created", entityType: "talent", entityId: talent.id, metadata: { source: "cds", cds_id: staged.cds_id, boards: boardIds.length } });
  return { id: talent.id, problem: problems.length ? `missing ${problems.join(", ")}` : undefined };
}
