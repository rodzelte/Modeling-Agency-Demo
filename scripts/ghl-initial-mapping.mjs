// One-time setup for the GHL sync (migration 026): records today's GHL pipelines
// and stages with their starting purpose, dashboard tag and status mapping, and
// reports what the first sync will do. After this, mappings are edited in
// Dashboard → GHL Sync → Mapping; new pipelines/stages arrive unmapped for review.
//
// Dry run by default (reads GHL and Supabase, writes nothing):
//   node --env-file=.env scripts/ghl-initial-mapping.mjs
//   node --env-file=.env scripts/ghl-initial-mapping.mjs --apply
//
// Never overwrites a mapping staff have already set (only fills blanks).
// Needs: GHL_API_TOKEN, GHL_LOCATION_ID, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.
import { createClient } from "@supabase/supabase-js";
import { deriveCrmStatus } from "../src/features/ghl/status.ts";

// Pipeline name → purpose, short dashboard tag, and stage name → normalized status.
// Derived from the stages and opportunity counts found in GHL on 2026-10-01.
const INITIAL = {
  "Talent Recruitment Pipeline": {
    purpose: "talent", badge: "Talent Recruitment", stages: {
      "One-on-One Casting Scheduled": "screening", "Group Casting Scheduled": "screening", "Zoom Call Completed": "screening",
      "No Show": "screening", "Zoom Meeting Rescheduled": "screening", "Proposal Sent": "accepted", "Talent Enrollment Invoice Sent": "accepted",
      "Talent Enrollment Fee Paid": "enrolled", "Onboarding Details Sent": "enrolled", "Onboarding Documents Signed": "enrolled",
      "Active Talent": "active", "Rejected": "rejected", "Archived": "archived",
    },
  },
  "Talent Screening Pipeline": {
    purpose: "talent", badge: "Talent Screening", stages: {
      "New Lead": "applicant", "Under Review": "screening", "Passed (for One-on-One Casting)": "screening", "Passed (for Group Casting)": "screening",
      "Not a Fit/Rejected": "rejected", "Follow up Later": "lead",
    },
  },
  "Dallas Model and Talent Expo": {
    purpose: "talent", badge: "Model Expo", stages: {
      "New Lead": "lead", "Audition Completed": "screening", "Interview Scheduled": "screening", "For Follow Up": "screening",
      "Send Invoice": "accepted", "Pending Payment": "accepted", "Enrolled": "enrolled",
    },
  },
  "Talent Qoutation": { purpose: "client", badge: null, stages: {} },
  "Revenue Pipeline": { purpose: "client", badge: null, stages: {} },
  // "The Model Way Academy" is left for review: it is empty and its stages
  // ("Closed") do not say whether someone enrolled.
};

const apply = process.argv.includes("--apply");
for (const name of ["GHL_API_TOKEN", "GHL_LOCATION_ID", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
  if (!process.env[name]) { console.error(`Missing ${name}`); process.exit(1); }
}
const API = "https://services.leadconnectorhq.com";
const headers = { Authorization: `Bearer ${process.env.GHL_API_TOKEN}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
const LOC = process.env.GHL_LOCATION_ID;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(method, path, body) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(new URL(path, API), { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (response.status === 429 || response.status >= 500) { await sleep(1500 * 2 ** attempt); continue; }
    if (!response.ok) throw new Error(`GHL ${path} ${response.status}`);
    return response.json();
  }
  throw new Error(`GHL ${path} kept failing`);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const { pipelines } = await call("GET", `/opportunities/pipelines?locationId=${LOC}`);
const opportunities = [];
for (let page = 1; page < 500; page += 1) {
  const result = await call("GET", `/opportunities/search?location_id=${LOC}&limit=100&page=${page}`);
  opportunities.push(...result.opportunities);
  if (result.opportunities.length < 100) break;
}
const contacts = [];
for (let after; ;) {
  const result = await call("POST", "/contacts/search", { locationId: LOC, pageLimit: 100, sort: [{ field: "dateUpdated", direction: "desc" }], ...(after ? { searchAfter: after } : { page: 1 }) });
  contacts.push(...result.contacts);
  if (result.contacts.length < 100) break;
  after = result.contacts.at(-1).searchAfter;
}
const { data: existingPipelines } = await db.from("ghl_pipelines").select("id,purpose,badge_label");
const { data: existingStages } = await db.from("ghl_pipeline_stages").select("id,normalized_status");
const { data: settings } = await db.from("ghl_settings").select("talent_statuses").single();
const knownPipeline = new Map((existingPipelines ?? []).map((row) => [row.id, row]));
const knownStage = new Map((existingStages ?? []).map((row) => [row.id, row]));

// What the mapping will be (existing staff choices win).
const pipelineMap = new Map();
const stageMap = new Map();
console.log("\nPIPELINES AND STAGES");
for (const pipeline of pipelines) {
  const plan = INITIAL[pipeline.name];
  const current = knownPipeline.get(pipeline.id);
  const purpose = current?.purpose ?? plan?.purpose ?? null;
  const badge = current?.badge_label ?? plan?.badge ?? null;
  pipelineMap.set(pipeline.id, { id: pipeline.id, name: pipeline.name, purpose, badge_label: badge });
  const count = opportunities.filter((item) => item.pipelineId === pipeline.id).length;
  console.log(`\n${pipeline.name}: ${purpose ?? "NEEDS REVIEW"}${badge ? ` · tag "${badge}"` : ""} · ${count} opportunities`);
  for (const stage of pipeline.stages ?? []) {
    const status = knownStage.get(stage.id)?.normalized_status ?? plan?.stages?.[stage.name] ?? null;
    stageMap.set(stage.id, { id: stage.id, name: stage.name, normalized_status: status });
    const inStage = opportunities.filter((item) => item.pipelineStageId === stage.id).length;
    console.log(`   ${stage.name.padEnd(36)} → ${(status ?? "unmapped").padEnd(10)} (${inStage})`);
  }
}

// Expected outcome of the first sync.
const talentStatuses = settings?.talent_statuses ?? ["enrolled", "active", "booked", "graduated"];
const byContact = new Map();
for (const item of opportunities) byContact.set(item.contactId, [...(byContact.get(item.contactId) ?? []), item]);
const tally = {};
const programs = {};
const qualifying = [];
for (const contact of contacts) {
  const result = deriveCrmStatus({
    opportunities: (byContact.get(contact.id) ?? []).map((item) => ({ pipeline_id: item.pipelineId, stage_id: item.pipelineStageId, status: item.status, changed_at: item.lastStageChangeAt ?? item.updatedAt })),
    tags: contact.tags ?? [], customFields: {}, pipelines: pipelineMap, stages: stageMap, rules: [], talentStatuses,
  });
  tally[result.status ?? "no status"] = (tally[result.status ?? "no status"] ?? 0) + 1;
  for (const program of result.programs) programs[program] = (programs[program] ?? 0) + 1;
  if (result.status && talentStatuses.includes(result.status)) qualifying.push(contact);
}
const { data: talent } = await db.from("talent").select("id");
const { data: apps } = await db.from("applications").select("external_id,status").eq("source", "ghl");
const appByContact = new Map((apps ?? []).map((row) => [row.external_id, row.status]));

console.log("\nFIRST SYNC WILL");
console.log(`  mirror ${contacts.length} contacts and ${opportunities.length} opportunities (all of them, with every custom field)`);
console.log("  CRM status per contact:", JSON.stringify(tally));
console.log(`  give ${qualifying.length} contacts a talent record (statuses: ${talentStatuses.join(", ")}); existing talent records: ${talent?.length ?? 0}`);
console.log("  dashboard tags:", JSON.stringify(programs));
console.log(`  of those, ${qualifying.filter((contact) => appByContact.has(contact.id)).length} already have a Join Us application (it is marked converted and linked, not duplicated)`);
console.log("  photos: Headshot, 3/4 Angle, Full Body and Photo's of the Models are downloaded for talent records only, once per GHL file");

if (!apply) {
  console.log("\nDry run: nothing written. Re-run with --apply to save this mapping.");
  process.exit(0);
}
const now = new Date().toISOString();
for (const pipeline of pipelines) {
  const mapped = pipelineMap.get(pipeline.id);
  const { error } = await db.from("ghl_pipelines").upsert({ id: pipeline.id, name: pipeline.name, raw: pipeline, purpose: mapped.purpose, badge_label: mapped.badge_label, last_seen_at: now }, { onConflict: "id" });
  if (error) throw error;
  const rows = (pipeline.stages ?? []).map((stage, index) => {
    const status = stageMap.get(stage.id).normalized_status;
    const already = knownStage.get(stage.id)?.normalized_status;
    return { id: stage.id, pipeline_id: pipeline.id, name: stage.name, position: stage.position ?? index, normalized_status: status, mapping_source: status ? (already ? undefined : "initial") : null, last_seen_at: now };
  }).map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)));
  if (rows.length) {
    const { error: stageError } = await db.from("ghl_pipeline_stages").upsert(rows, { onConflict: "id" });
    if (stageError) throw stageError;
  }
}
console.log("\nMapping saved. Next: run the sync (Dashboard → GHL Sync → Run sync now, or POST /api/integrations/ghl/sync with CRON_SECRET).");
