import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadPhoto } from "@/features/applications/ingest";
import { log } from "@/lib/log";
import { ghl, isNotFound, type GhlContact, type GhlCustomFieldValue, type GhlOpportunity } from "./client";
import {
  CUSTOM_TARGETS, DEFAULT_TARGETS, PHOTO_TARGETS, filesIn, ghlFormat, isCustomTarget, normalizeValue,
  type CustomTarget, type NativeTarget, type Ownership,
} from "./fields";
import { decideInbound, shouldPush } from "./merge";
import { deriveCrmStatus, isCrmStatus, type CrmStatus, type StatusPipeline, type StatusRule, type StatusStage } from "./status";

// The sync itself. Every function takes the secret-key client from engine.ts;
// none of them is reachable from the browser. Writes are idempotent upserts keyed
// on GHL ids, so any step can be retried or run twice safely.

type Db = SupabaseClient;
export type SyncStats = Record<string, number>;
export const bump = (stats: SyncStats, key: string, by = 1) => { stats[key] = (stats[key] ?? 0) + by; };

// Throws on a database error; returns the rows (an empty list when there are none).
const must = <T>(result: { data: T | null; error: { message: string; code?: string } | null }, what: string): T => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return (result.data ?? []) as T;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export type FieldMapping = { id: string; name: string; target: CustomTarget; ownership: Ownership };
export type SyncConfig = {
  pipelines: Map<string, StatusPipeline>;
  stages: Map<string, StatusStage>;
  rules: StatusRule[];
  talentStatuses: CrmStatus[];
  writeback: boolean;
  mappings: FieldMapping[];
};

export async function loadConfig(db: Db): Promise<SyncConfig> {
  const [pipelines, stages, rules, settings, fields] = await Promise.all([
    db.from("ghl_pipelines").select("id,name,purpose,badge_label").is("removed_at", null),
    db.from("ghl_pipeline_stages").select("id,name,normalized_status"),
    db.from("ghl_status_rules").select("kind,field_id,match_value,normalized_status"),
    db.from("ghl_settings").select("talent_statuses,writeback_enabled").maybeSingle(),
    db.from("ghl_field_definitions").select("id,name,target,ownership").not("target", "is", null).is("removed_at", null).order("name"),
  ]);
  return {
    pipelines: new Map(must(pipelines, "pipelines").map((row) => [row.id, row as StatusPipeline])),
    stages: new Map(must(stages, "stages").map((row) => [row.id, row as StatusStage])),
    rules: must(rules, "rules") as StatusRule[],
    talentStatuses: ((must(settings, "settings")?.talent_statuses ?? []) as string[]).filter(isCrmStatus),
    writeback: Boolean(settings.data?.writeback_enabled),
    mappings: must(fields, "fields").filter((row) => isCustomTarget(row.target)) as FieldMapping[],
  };
}

// ---------------------------------------------------------------------------
// Discovery: pipelines, stages, field definitions, custom values, users
// ---------------------------------------------------------------------------
export async function discover(db: Db, stats: SyncStats) {
  const now = new Date().toISOString();
  const [pipelines, fields, values, users] = await Promise.all([ghl.pipelines(), ghl.customFields(), ghl.customValues(), ghl.users()]);

  const knownPipelines = new Set(must(await db.from("ghl_pipelines").select("id"), "pipelines").map((row) => row.id));
  const knownStages = new Set(must(await db.from("ghl_pipeline_stages").select("id"), "stages").map((row) => row.id));
  for (const pipeline of pipelines) {
    if (!knownPipelines.has(pipeline.id)) bump(stats, "pipelines_discovered");
    // purpose / badge_label are staff settings: never overwritten here.
    must(await db.from("ghl_pipelines").upsert({ id: pipeline.id, name: pipeline.name, raw: pipeline, last_seen_at: now, removed_at: null }, { onConflict: "id" }), "upsert pipeline");
    const stages = (pipeline.stages ?? []).map((stage, index) => {
      if (!knownStages.has(stage.id)) bump(stats, "stages_discovered");
      return { id: stage.id, pipeline_id: pipeline.id, name: stage.name, position: stage.position ?? index, last_seen_at: now, removed_at: null };
    });
    if (stages.length) must(await db.from("ghl_pipeline_stages").upsert(stages, { onConflict: "id" }), "upsert stages");
  }
  const pipelineIds = pipelines.map((pipeline) => pipeline.id);
  if (pipelineIds.length) {
    await db.from("ghl_pipelines").update({ removed_at: now }).not("id", "in", `(${pipelineIds.map((id) => `"${id}"`).join(",")})`).is("removed_at", null);
  }
  await db.from("ghl_pipeline_stages").update({ removed_at: now }).lt("last_seen_at", now).is("removed_at", null);

  const knownFields = new Map(must(await db.from("ghl_field_definitions").select("id"), "fields").map((row) => [row.id, true]));
  const fieldRows = fields.map((field) => {
    const base = {
      id: field.id, object_key: field.model ?? "contact", name: field.name, field_key: field.fieldKey ?? null, data_type: field.dataType ?? null,
      options: field.picklistOptions ?? null, raw: field, last_seen_at: now, removed_at: null,
    };
    if (knownFields.has(field.id)) return base;
    bump(stats, "fields_discovered");
    // First sighting: seed the mapping for known GHL keys; staff can change it.
    const target = field.fieldKey ? DEFAULT_TARGETS[field.fieldKey] : undefined;
    return { ...base, target: target ?? null, ownership: target ? CUSTOM_TARGETS[target].ownership : "ghl_only" };
  });
  for (const chunk of chunks(fieldRows, 200)) {
    // Existing rows keep their staff-set target/ownership (not in the payload).
    const fresh = chunk.filter((row) => "target" in row);
    const known = chunk.filter((row) => !("target" in row));
    if (fresh.length) must(await db.from("ghl_field_definitions").upsert(fresh, { onConflict: "id" }), "insert fields");
    if (known.length) must(await db.from("ghl_field_definitions").upsert(known, { onConflict: "id" }), "update fields");
  }
  await db.from("ghl_field_definitions").update({ removed_at: now }).lt("last_seen_at", now).is("removed_at", null);

  if (values.length) {
    must(await db.from("ghl_custom_values").upsert(values.map((value) => ({
      id: value.id, name: value.name, field_key: value.fieldKey ?? null, value: value.value ?? null, last_seen_at: now, removed_at: null, updated_at: now,
    })), { onConflict: "id" }), "upsert custom values");
  }
  await db.from("ghl_custom_values").update({ removed_at: now }).lt("last_seen_at", now).is("removed_at", null);

  if (users.length) {
    must(await db.from("ghl_users").upsert(users.map((user) => ({
      id: user.id, name: user.name ?? ([user.firstName, user.lastName].filter(Boolean).join(" ") || null), email: user.email ?? null,
      role: user.roles?.role ?? null, last_seen_at: now, removed_at: null,
    })), { onConflict: "id" }), "upsert users");
  }
  await db.from("ghl_users").update({ removed_at: now }).lt("last_seen_at", now).is("removed_at", null);
  bump(stats, "pipelines_seen", pipelines.length);
  bump(stats, "fields_seen", fields.length);
}

export function* chunks<T>(items: T[], size: number) {
  for (let index = 0; index < items.length; index += size) yield items.slice(index, index + size);
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------
const customFieldMap = (values: GhlCustomFieldValue[] | undefined) =>
  Object.fromEntries((values ?? []).map((field) => [field.id, field.value ?? field.field_value ?? null]).filter(([, value]) => value !== null && value !== ""));

// Upserts opportunities, records stage/status changes, and returns the ids of
// contacts whose opportunities changed (they need their status recomputed).
export async function saveOpportunities(db: Db, opportunities: GhlOpportunity[], stats: SyncStats): Promise<Set<string>> {
  const changedContacts = new Set<string>();
  for (const batch of chunks(opportunities, 100)) {
    const existing = new Map(must(await db.from("ghl_opportunities").select("id,contact_id,stage_id,status,source_updated_at").in("id", batch.map((item) => item.id)), "existing opportunities")
      .map((row) => [row.id, row]));
    const history = [];
    for (const item of batch) {
      const before = existing.get(item.id);
      if (!before || before.stage_id !== (item.pipelineStageId ?? null) || before.status !== (item.status ?? null)) {
        changedContacts.add(item.contactId);
        if (before?.contact_id && before.contact_id !== item.contactId) changedContacts.add(before.contact_id);
        history.push({
          opportunity_id: item.id, contact_id: item.contactId, pipeline_id: item.pipelineId,
          from_stage_id: before?.stage_id ?? null, to_stage_id: item.pipelineStageId ?? null, from_status: before?.status ?? null, to_status: item.status ?? null,
          changed_at: (before?.stage_id !== (item.pipelineStageId ?? null) ? item.lastStageChangeAt : item.lastStatusChangeAt) ?? item.updatedAt ?? new Date().toISOString(),
        });
      }
    }
    must(await db.from("ghl_opportunities").upsert(batch.map((item) => ({
      id: item.id, contact_id: item.contactId, pipeline_id: item.pipelineId, stage_id: item.pipelineStageId ?? null, name: item.name ?? null,
      status: item.status ?? null, monetary_value: item.monetaryValue ?? null, source: item.source ?? null, assigned_to: item.assignedTo ?? null,
      custom_fields: customFieldMap(item.customFields), raw: { ...item, contact: undefined },
      last_stage_change_at: item.lastStageChangeAt ?? null, last_status_change_at: item.lastStatusChangeAt ?? null,
      source_created_at: item.createdAt ?? null, source_updated_at: item.updatedAt ?? null, synced_at: new Date().toISOString(), removed_at: null,
    })), { onConflict: "id" }), "upsert opportunities");
    if (history.length) must(await db.from("ghl_opportunity_history").insert(history), "opportunity history");
    bump(stats, "opportunities_seen", batch.length);
    bump(stats, "opportunity_changes", history.length);
  }
  return changedContacts;
}

async function opportunitiesFor(contactId: string): Promise<GhlOpportunity[]> {
  const all: GhlOpportunity[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await ghl.opportunitiesPage(page, contactId);
    const items = (result.opportunities ?? []).filter((item) => item.contactId === contactId);
    all.push(...items);
    if ((result.opportunities ?? []).length < 100) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// One contact, end to end
// ---------------------------------------------------------------------------
export async function syncContact(db: Db, contactId: string, config: SyncConfig, stats: SyncStats) {
  let contact: GhlContact | null;
  try {
    contact = await ghl.contact(contactId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    contact = null;
  }
  if (!contact) {
    // Deleted in GHL: keep our copy (and any talent) but mark it removed.
    await db.from("ghl_contacts").update({ removed_at: new Date().toISOString() }).eq("id", contactId);
    bump(stats, "contacts_removed");
    return;
  }

  const opportunities = await opportunitiesFor(contactId);
  await saveOpportunities(db, opportunities, stats);
  const custom = customFieldMap(contact.customFields);
  const status = deriveCrmStatus({
    opportunities: opportunities.map((item) => ({ pipeline_id: item.pipelineId, stage_id: item.pipelineStageId ?? null, status: item.status ?? null, changed_at: item.lastStageChangeAt ?? item.updatedAt ?? null })),
    tags: contact.tags ?? [], customFields: custom, pipelines: config.pipelines, stages: config.stages, rules: config.rules, talentStatuses: config.talentStatuses,
  });

  const now = new Date().toISOString();
  must(await db.from("ghl_contacts").upsert({
    id: contact.id, first_name: contact.firstName ?? null, last_name: contact.lastName ?? null, email: contact.email ?? null, phone: contact.phone ?? null,
    date_of_birth: normalizeValue("date_of_birth", contact.dateOfBirth), contact_type: contact.type ?? null, source: contact.source ?? null,
    tags: contact.tags ?? [], assigned_to: contact.assignedTo ?? null, address_1: contact.address1 ?? null, city: contact.city ?? null,
    state: contact.state ?? null, postal_code: contact.postalCode ?? null, country: contact.country ?? null, custom_fields: custom, raw: contact,
    source_created_at: contact.dateAdded ?? null, source_updated_at: contact.dateUpdated ?? null, full_fetched_at: now, synced_at: now,
    crm_status: status.status, crm_status_reason: status.reason, programs: status.programs, removed_at: null,
  }, { onConflict: "id" }), "upsert contact");
  bump(stats, "contacts_synced");

  const { data: link } = await db.from("ghl_contacts").select("talent_id,auto_create_blocked").eq("id", contact.id).single();
  let talentId: string | null = link?.talent_id ?? null;
  const qualifies = status.status !== null && config.talentStatuses.includes(status.status);
  if (!talentId && qualifies && !link?.auto_create_blocked) {
    const { data: created, error } = await db.rpc("ghl_link_talent", { p_contact_id: contact.id, p_create: true });
    if (error) throw new Error(`link talent: ${error.message}`);
    talentId = created as string | null;
    if (talentId) bump(stats, "talents_linked_or_created");
  }
  if (!talentId) return;

  must(await db.from("talent").update({ crm_status: status.status, crm_programs: status.programs }).eq("id", talentId), "talent status");
  const changed = await applyFields(db, talentId, contact, custom, config, stats);
  if (changed) bump(stats, "talents_updated");
  await storePhotos(db, talentId, custom, config, stats);
}

// ---------------------------------------------------------------------------
// Field values: GHL → dashboard, with ownership, loop prevention and conflicts
// ---------------------------------------------------------------------------
type Target = CustomTarget | NativeTarget;
const MEASUREMENT_COLUMNS: Partial<Record<Target, string>> = {
  height_cm: "height_cm", bust_cm: "bust_chest_cm", waist_cm: "waist_cm", hips_cm: "hips_cm", weight_kg: "weight_kg", shoe_size: "shoe_size_us",
  shirt_size: "shirt_size", pants_size: "pants_size", dress_size: "dress_size", hair_color: "hair_color", eye_color: "eye_color", ethnicity: "ethnicity",
};
const SOCIAL: Partial<Record<Target, string>> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };
const NATIVE_OWNERSHIP: Ownership = "bidirectional";

const str = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

// Dashboard value in the form it would have after a round trip through GHL, so
// rounding (cm → feet/inches → cm) never looks like a change.
export function comparable(target: Target, value: string | null) {
  if (value === null) return null;
  return MEASUREMENT_COLUMNS[target] && ["height_cm", "bust_cm", "waist_cm", "hips_cm", "weight_kg"].includes(target)
    ? normalizeValue(target, ghlFormat(target, normalizeValue(target, value) ?? value)) : normalizeValue(target, value);
}

type DashboardState = {
  values: Map<Target, string | null>;
  measurement: Record<string, unknown> | null;
  address: Record<string, unknown> | null;
  social: Map<string, { id: string; handle: string | null }>;
};

export async function loadDashboard(db: Db, talentId: string): Promise<DashboardState> {
  const [talent, details, measurement, address, social] = await Promise.all([
    db.from("talent").select("first_name,last_name,gender,location").eq("id", talentId).single(),
    db.from("talent_private_details").select("email,mobile,date_of_birth").eq("talent_id", talentId).maybeSingle(),
    db.from("talent_measurements").select("*").eq("talent_id", talentId).order("measured_on", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("talent_addresses").select("id,address_1,city,state,postal_code,country").eq("talent_id", talentId).order("is_main", { ascending: false }).order("created_at").limit(1).maybeSingle(),
    db.from("talent_social_accounts").select("id,platform,handle").eq("talent_id", talentId),
  ]);
  const t = must(talent, "talent") as Record<string, unknown>;
  const d = (details.data ?? {}) as Record<string, unknown>;
  const m = measurement.data as Record<string, unknown> | null;
  const values = new Map<Target, string | null>([
    ["first_name", str(t.first_name)], ["last_name", str(t.last_name)], ["gender", str(t.gender)], ["location", str(t.location)],
    ["email", normalizeValue("email", d.email)], ["phone", str(d.mobile)], ["date_of_birth", str(d.date_of_birth)],
    ["address", addressKey(address.data)],
  ]);
  for (const [target, column] of Object.entries(MEASUREMENT_COLUMNS)) values.set(target as Target, comparable(target as Target, str(m?.[column])));
  const socialRows = new Map<string, { id: string; handle: string | null }>();
  for (const row of (social.data ?? []) as { id: string; platform: string; handle: string | null }[]) socialRows.set(row.platform.toLowerCase(), row);
  for (const [target, platform] of Object.entries(SOCIAL)) values.set(target as Target, normalizeValue(target as Target, socialRows.get(platform.toLowerCase())?.handle));
  return { values, measurement: m, address: address.data, social: socialRows };
}

function addressKey(row: Record<string, unknown> | null | undefined) {
  if (!row) return null;
  const parts = ["address_1", "city", "state", "postal_code", "country"].map((key) => str(row[key])?.trim() ?? "");
  return parts.some(Boolean) ? JSON.stringify(parts) : null;
}

// Incoming GHL values per target (first mapped field with a readable value wins,
// in field-name order, e.g. "Bust" before "Chest").
export function incomingValues(contact: GhlContact, custom: Record<string, unknown>, mappings: FieldMapping[]) {
  const values = new Map<Target, { value: string | null; ownership: Ownership }>([
    ["first_name", { value: str(contact.firstName?.trim()), ownership: NATIVE_OWNERSHIP }],
    ["last_name", { value: str(contact.lastName?.trim()), ownership: NATIVE_OWNERSHIP }],
    ["email", { value: normalizeValue("email", contact.email), ownership: NATIVE_OWNERSHIP }],
    ["phone", { value: normalizeValue("phone", contact.phone), ownership: NATIVE_OWNERSHIP }],
    ["date_of_birth", { value: normalizeValue("date_of_birth", contact.dateOfBirth), ownership: NATIVE_OWNERSHIP }],
    ["address", { value: addressKey({ address_1: contact.address1, city: contact.city, state: contact.state, postal_code: contact.postalCode, country: contact.country }), ownership: NATIVE_OWNERSHIP }],
  ]);
  for (const mapping of mappings) {
    if (mapping.target in PHOTO_TARGETS) continue;
    const value = normalizeValue(mapping.target, custom[mapping.id]);
    const current = values.get(mapping.target);
    if (!current || (current.value === null && value !== null)) values.set(mapping.target, { value, ownership: mapping.ownership });
  }
  return values;
}

async function applyFields(db: Db, talentId: string, contact: GhlContact, custom: Record<string, unknown>, config: SyncConfig, stats: SyncStats) {
  const dashboard = await loadDashboard(db, talentId);
  const state = new Map(((await db.from("ghl_field_state").select("target,value").eq("talent_id", talentId)).data ?? []).map((row) => [row.target, row.value as string | null]));
  const incoming = incomingValues(contact, custom, config.mappings);

  const applied = new Map<Target, string>();
  const agreed: { target: string; value: string }[] = [];
  for (const [target, { value, ownership }] of incoming) {
    const decision = decideInbound(ownership, state.has(target) ? state.get(target) ?? null : undefined, dashboard.values.get(target) ?? null, value);
    if (decision.action === "apply") applied.set(target, decision.value);
    else if (decision.action === "agree") agreed.push({ target, value: decision.value });
    else if (decision.action === "conflict") {
      const { error } = await db.from("ghl_sync_conflicts").insert({
        talent_id: talentId, contact_id: contact.id, target, base_value: decision.base, dashboard_value: decision.dashboard, ghl_value: decision.ghl,
      });
      if (!error) bump(stats, "conflicts_detected");
      else if (error.code !== "23505") throw new Error(`conflict: ${error.message}`);
    }
  }

  if (applied.size) await writeDashboard(db, talentId, applied, dashboard, contact);
  const states = [...[...applied].map(([target, value]) => ({ target, value })), ...agreed]
    .map((row) => ({ talent_id: talentId, target: row.target, value: row.value, source: "ghl", synced_at: new Date().toISOString() }));
  if (states.length) must(await db.from("ghl_field_state").upsert(states, { onConflict: "talent_id,target" }), "field state");
  bump(stats, "fields_applied", applied.size);
  return applied.size > 0;
}

// Writes accepted GHL values into the talent tables (secret key: these writes do
// not queue a push back to GHL, see queue_ghl_push()).
export async function writeDashboard(db: Db, talentId: string, applied: Map<Target, string>, dashboard: DashboardState, contact?: GhlContact) {
  const talentUpdate: Record<string, unknown> = {};
  if (applied.has("first_name")) talentUpdate.first_name = applied.get("first_name");
  if (applied.has("last_name")) talentUpdate.last_name = applied.get("last_name");
  if (applied.has("gender")) talentUpdate.gender = applied.get("gender");
  if (applied.has("location")) talentUpdate.location = applied.get("location");
  if (applied.has("date_of_birth")) {
    const dob = new Date(`${applied.get("date_of_birth")}T00:00:00Z`);
    const adult = new Date(dob); adult.setUTCFullYear(dob.getUTCFullYear() + 18);
    talentUpdate.is_minor = adult.getTime() > Date.now();
  }
  if (Object.keys(talentUpdate).length) must(await db.from("talent").update(talentUpdate).eq("id", talentId), "talent fields");

  const details: Record<string, unknown> = {};
  if (applied.has("email")) details.email = applied.get("email");
  if (applied.has("phone")) details.mobile = applied.get("phone");
  if (applied.has("date_of_birth")) details.date_of_birth = applied.get("date_of_birth");
  if (Object.keys(details).length) must(await db.from("talent_private_details").upsert({ talent_id: talentId, ...details }, { onConflict: "talent_id" }), "private details");

  if (applied.has("address")) {
    const [address_1, city, state, postal_code, country] = JSON.parse(applied.get("address") as string) as string[];
    const row = { address_1: address_1 || null, city: city || null, state: state || null, postal_code: postal_code || null, country: country || null };
    if (dashboard.address?.id) must(await db.from("talent_addresses").update({ ...row, updated_at: new Date().toISOString() }).eq("id", dashboard.address.id as string), "address");
    else must(await db.from("talent_addresses").insert({ talent_id: talentId, label: "Home", is_main: true, ...row }), "address");
  }

  for (const [target, platform] of Object.entries(SOCIAL)) {
    if (!applied.has(target as Target)) continue;
    const existing = dashboard.social.get(platform.toLowerCase());
    const handle = applied.get(target as Target);
    if (existing) must(await db.from("talent_social_accounts").update({ handle }).eq("id", existing.id), "social");
    else must(await db.from("talent_social_accounts").insert({ talent_id: talentId, platform, handle }), "social");
  }

  // Measurements are snapshots: one new GHL snapshot carrying the latest values.
  const measured = Object.entries(MEASUREMENT_COLUMNS).filter(([target]) => applied.has(target as Target));
  if (measured.length) {
    const previous = dashboard.measurement ?? {};
    const keep = ["height_cm", "bust_chest_cm", "waist_cm", "hips_cm", "weight_kg", "shoe_size_us", "shirt_size", "pants_size", "dress_size", "hair_color", "eye_color", "ethnicity",
      "head_cm", "collar_cm", "hair_length", "hair_type", "body_type", "suit_size", "suit_length", "shoe_size_custom", "gloves", "inseam_cm", "outseam_cm", "sleeve_cm"];
    const snapshot: Record<string, unknown> = Object.fromEntries(keep.map((column) => [column, previous[column] ?? null]));
    for (const [target, column] of measured) {
      const value = applied.get(target as Target) as string;
      snapshot[column] = ["height_cm", "bust_cm", "waist_cm", "hips_cm", "weight_kg"].includes(target) ? Number(value) : value;
    }
    must(await db.from("talent_measurements").insert({
      talent_id: talentId, ...snapshot, source: "ghl", is_official: false,
      notes: `Synced from GHL${contact?.dateUpdated ? ` (contact updated ${contact.dateUpdated.slice(0, 10)})` : ""}`,
    }), "measurements");
  }
}

// ---------------------------------------------------------------------------
// Photos: GHL file fields → talent-private, once per GHL file
// ---------------------------------------------------------------------------
const MAX_PHOTOS_PER_RUN = 12;

async function storePhotos(db: Db, talentId: string, custom: Record<string, unknown>, config: SyncConfig, stats: SyncStats) {
  const wanted = config.mappings.filter((mapping) => mapping.target in PHOTO_TARGETS)
    .flatMap((mapping) => filesIn(custom[mapping.id]).map((file) => ({ ...file, role: PHOTO_TARGETS[mapping.target] ?? null, label: CUSTOM_TARGETS[mapping.target].label.replace(/^Photos?: /, "") })));
  if (!wanted.length) return;

  const [{ data: photos }, { data: marks }] = await Promise.all([
    db.from("talent_photos").select("id,external_id,content_sha256").eq("talent_id", talentId),
    db.from("ghl_field_state").select("target,value").eq("talent_id", talentId).like("target", "file:%"),
  ]);
  const stored = new Set((photos ?? []).map((row) => row.external_id).filter(Boolean));
  const hashes = new Map((photos ?? []).filter((row) => row.content_sha256).map((row) => [row.content_sha256 as string, row.id as string]));
  const marked = new Map((marks ?? []).map((row) => [row.target.slice(5), String(row.value ?? "")]));
  let done = 0;

  for (const file of wanted) {
    if (stored.has(file.id)) continue;
    const mark = marked.get(file.id) ?? "";
    if (mark.startsWith("duplicate")) continue;
    const failures = Number(mark.match(/^failed:(\d+)/)?.[1] ?? 0);
    if (failures >= 3) continue;
    if (done >= MAX_PHOTOS_PER_RUN) { bump(stats, "photos_deferred"); continue; }
    done += 1;
    try {
      // Original phone photos can exceed 15 MB; they are re-encoded to at most 2400px below.
      const bytes = await downloadPhoto(new URL(file.url), 30 * 1024 * 1024);
      const sha = createHash("sha256").update(bytes).digest("hex");
      const duplicateOf = hashes.get(sha);
      if (duplicateOf) {
        await db.from("ghl_field_state").upsert({ talent_id: talentId, target: `file:${file.id}`, value: `duplicate:${duplicateOf}`, source: "ghl" }, { onConflict: "talent_id,target" });
        bump(stats, "photos_duplicate");
        continue;
      }
      const image = sharp(bytes, { failOn: "error", limitInputPixels: 80_000_000 }).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true });
      const { data: jpeg, info } = await image.jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      const path = `talent/${talentId}/ghl-${file.id.replace(/[^a-zA-Z0-9-]/g, "")}.jpg`;
      const upload = await db.storage.from("talent-private").upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
      if (upload.error) throw upload.error;
      const { error } = await db.from("talent_photos").insert({
        talent_id: talentId, storage_path: path, storage_bucket: "talent-private", public: false, publish_to_website: false,
        image_type: file.role === "headshot" ? "headshot" : "digital", title: file.label, original_file_name: file.name,
        mime_type: "image/jpeg", file_size: jpeg.byteLength, width: info.width, height: info.height,
        source: "ghl", external_id: file.id, source_url: file.url.split("?")[0], photo_role: file.role, content_sha256: sha,
        synced_at: new Date().toISOString(), display_order: file.role === "headshot" ? 0 : file.role === "three_quarter" ? 1 : file.role === "full_body" ? 2 : 10,
      });
      if (error && error.code !== "23505") throw error;
      if (failures) await db.from("ghl_field_state").delete().eq("talent_id", talentId).eq("target", `file:${file.id}`);
      hashes.set(sha, file.id);
      stored.add(file.id);
      bump(stats, "photos_stored");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("ghl", "photo not stored", { talent: talentId, file: file.id, error: message.slice(0, 200) });
      await db.from("ghl_field_state").upsert({ talent_id: talentId, target: `file:${file.id}`, value: `failed:${failures + 1}:${message.slice(0, 150)}`, source: "ghl" }, { onConflict: "talent_id,target" });
      bump(stats, "photos_failed");
    }
  }
}

// ---------------------------------------------------------------------------
// Dashboard → GHL (bidirectional fields only, when write-back is on)
// ---------------------------------------------------------------------------
export async function pushContact(db: Db, contactId: string, config: SyncConfig, stats: SyncStats) {
  if (!config.writeback) return;
  const { data: contact } = await db.from("ghl_contacts").select("id,talent_id,removed_at").eq("id", contactId).maybeSingle();
  if (!contact?.talent_id || contact.removed_at) return;
  const talentId = contact.talent_id as string;
  const dashboard = await loadDashboard(db, talentId);
  const state = new Map(((await db.from("ghl_field_state").select("target,value").eq("talent_id", talentId)).data ?? []).map((row) => [row.target, row.value as string | null]));

  const body: Record<string, unknown> = {};
  const customFields: { id: string; field_value: string }[] = [];
  const pushed: { target: string; value: string }[] = [];
  const consider = (target: Target, ownership: Ownership, apply: (formatted: string) => void) => {
    const value = dashboard.values.get(target) ?? null;
    const base = state.has(target) ? state.get(target) ?? null : undefined;
    if (!shouldPush(ownership, base, value)) return;
    apply(ghlFormat(target, value) as string);
    pushed.push({ target, value: value as string });
  };
  consider("first_name", NATIVE_OWNERSHIP, (value) => { body.firstName = value; });
  consider("last_name", NATIVE_OWNERSHIP, (value) => { body.lastName = value; });
  consider("email", NATIVE_OWNERSHIP, (value) => { body.email = value; });
  consider("phone", NATIVE_OWNERSHIP, (value) => { body.phone = value; });
  consider("date_of_birth", NATIVE_OWNERSHIP, (value) => { body.dateOfBirth = value; });
  consider("address", NATIVE_OWNERSHIP, (value) => {
    const [address1, city, stateName, postalCode, country] = JSON.parse(value) as string[];
    Object.assign(body, { address1, city, state: stateName, postalCode, country });
  });
  const seen = new Set<string>();
  for (const mapping of config.mappings) {
    if (mapping.target in PHOTO_TARGETS || seen.has(mapping.target)) continue;
    seen.add(mapping.target);
    consider(mapping.target, mapping.ownership, (value) => customFields.push({ id: mapping.id, field_value: value }));
  }
  if (customFields.length) body.customFields = customFields;
  if (!pushed.length) return;

  await ghl.updateContact(contactId, body);
  must(await db.from("ghl_field_state").upsert(pushed.map((row) => ({ talent_id: talentId, target: row.target, value: row.value, source: "dashboard", synced_at: new Date().toISOString() })), { onConflict: "talent_id,target" }), "field state");
  bump(stats, "fields_pushed", pushed.length);
}
