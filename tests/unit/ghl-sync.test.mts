// GHL sync pure logic: status derivation, field normalization, three-way merge.
// Run: npm run test:unit
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deriveCrmStatus, type CrmStatus, type StatusPipeline, type StatusStage } from "../../src/features/ghl/status.ts";
import { displayValue, filesIn, ghlFormat, instagramHandle, normalizeValue, parseWeight } from "../../src/features/ghl/fields.ts";
import { decideInbound, shouldPush } from "../../src/features/ghl/merge.ts";

const pipelines = new Map<string, StatusPipeline>([
  ["rec", { id: "rec", name: "Talent Recruitment Pipeline", purpose: "talent", badge_label: "Talent Recruitment" }],
  ["expo", { id: "expo", name: "Dallas Model and Talent Expo", purpose: "talent", badge_label: "Model Expo" }],
  ["sales", { id: "sales", name: "Revenue Pipeline", purpose: "client", badge_label: null }],
  ["new", { id: "new", name: "Brand New Pipeline", purpose: null, badge_label: null }],
]);
const stage = (id: string, name: string, normalized_status: CrmStatus | null): [string, StatusStage] => [id, { id, name, normalized_status }];
const stages = new Map<string, StatusStage>([
  stage("rec-active", "Active Talent", "active"), stage("rec-proposal", "Proposal Sent", "accepted"), stage("rec-rejected", "Rejected", "rejected"),
  stage("expo-enrolled", "Enrolled", "enrolled"), stage("expo-lead", "New Lead", "lead"), stage("expo-unmapped", "Something New", null),
  stage("sales-closed", "Closed", "active"), stage("new-stage", "Won", "active"),
]);
const base = { tags: [], customFields: {}, pipelines, stages, rules: [], talentStatuses: ["enrolled", "active", "booked", "graduated"] as CrmStatus[] };
const opp = (pipeline_id: string, stage_id: string, status = "open", changed_at = "2026-09-01") => ({ pipeline_id, stage_id, status, changed_at });

describe("CRM status", () => {
  test("the strongest live status wins across pipelines", () => {
    const result = deriveCrmStatus({ ...base, opportunities: [opp("expo", "expo-lead"), opp("rec", "rec-active")] });
    assert.equal(result.status, "active");
    assert.equal(result.reason, "Talent Recruitment Pipeline → Active Talent");
    assert.deepEqual(result.programs, ["Talent Recruitment"]);
  });

  test("enrolled at the expo is tagged Model Expo", () => {
    const result = deriveCrmStatus({ ...base, opportunities: [opp("expo", "expo-enrolled", "won")] });
    assert.deepEqual(result, { status: "enrolled", reason: "Dallas Model and Talent Expo → Enrolled", programs: ["Model Expo"] });
  });

  test("both programs are listed when a model qualifies through both", () => {
    const result = deriveCrmStatus({ ...base, opportunities: [opp("expo", "expo-enrolled"), opp("rec", "rec-active")] });
    assert.deepEqual(result.programs, ["Model Expo", "Talent Recruitment"]);
  });

  test("client pipelines, unreviewed pipelines and unmapped stages never decide talent status", () => {
    assert.equal(deriveCrmStatus({ ...base, opportunities: [opp("sales", "sales-closed"), opp("new", "new-stage"), opp("expo", "expo-unmapped")] }).status, null);
  });

  test("lost or abandoned opportunities count as inactive, not as progress", () => {
    assert.equal(deriveCrmStatus({ ...base, opportunities: [opp("rec", "rec-proposal", "lost")] }).status, "inactive");
    assert.equal(deriveCrmStatus({ ...base, opportunities: [opp("rec", "rec-proposal", "lost"), opp("expo", "expo-lead")] }).status, "lead");
  });

  test("ending statuses apply only when nothing live remains; the latest one wins", () => {
    const result = deriveCrmStatus({ ...base, opportunities: [opp("rec", "rec-rejected", "open", "2026-01-01"), opp("rec", "rec-proposal", "abandoned", "2026-05-01")] });
    assert.equal(result.status, "inactive");
  });

  test("tag and field rules add statuses", () => {
    const rules = [
      { kind: "tag" as const, field_id: null, match_value: "Contract Signed", normalized_status: "active" as CrmStatus },
      { kind: "contact_field" as const, field_id: "f1", match_value: "Inactive Talent", normalized_status: "inactive" as CrmStatus },
    ];
    assert.equal(deriveCrmStatus({ ...base, rules, opportunities: [], tags: ["contract signed"] }).status, "active");
    assert.equal(deriveCrmStatus({ ...base, rules, opportunities: [], customFields: { f1: "Inactive Talent" } }).status, "inactive");
  });
});

describe("field values", () => {
  test("measurements typed in GHL normalize; unreadable values stay blank", () => {
    assert.equal(normalizeValue("height_cm", "5’9”"), "175");
    assert.equal(normalizeValue("height_cm", "5 10.5’"), null);
    assert.equal(normalizeValue("bust_cm", "34C"), "86.4");
    assert.equal(normalizeValue("waist_cm", "63cm"), "63");
    assert.equal(normalizeValue("hips_cm", "N/A"), null);
    assert.equal(normalizeValue("hips_cm", "Unknown"), null);
    assert.equal(normalizeValue("shoe_size", "M"), "M");
    assert.equal(normalizeValue("gender", ""), null);
    assert.equal(normalizeValue("email", " Maya@Example.TEST "), "maya@example.test");
  });

  test("weights: pounds unless marked kg", () => {
    assert.equal(parseWeight("120lbs"), 54.4);
    assert.equal(parseWeight("125"), 56.7);
    assert.equal(parseWeight("56 kg"), 56);
    assert.equal(parseWeight("Test"), null);
  });

  test("instagram handles from URLs and @names", () => {
    assert.equal(instagramHandle("https://www.instagram.com/johnplutino?stkn=x&utm_source=qr"), "@johnplutino");
    assert.equal(instagramHandle("Model.emmapistone"), "@Model.emmapistone");
    assert.equal(instagramHandle("@odessasoleil (model) @other"), "@odessasoleil (model) @other");
  });

  test("dashboard values round-trip through GHL formats without drift", () => {
    for (const cm of ["175", "180", "163"]) assert.equal(normalizeValue("height_cm", ghlFormat("height_cm", cm)), cm);
    assert.equal(ghlFormat("height_cm", "175"), `5'9"`);
    assert.equal(normalizeValue("waist_cm", ghlFormat("waist_cm", "66")), "66");
    assert.equal(normalizeValue("weight_kg", ghlFormat("weight_kg", "54.4")), "54.4");
  });

  test("GHL file values become files; other objects are not displayed", () => {
    const value = { "4a41e68d-ff68-4b60-8f73-2249abae8ae5": { meta: { originalname: "IMG_1447.JPG", mimetype: "image/jpeg", size: 6037438, uuid: "4a41e68d-ff68-4b60-8f73-2249abae8ae5" }, url: "https://services.leadconnectorhq.com/documents/download/abc", documentId: "abc" } };
    assert.deepEqual(filesIn(value), [{ id: "4a41e68d-ff68-4b60-8f73-2249abae8ae5", url: "https://services.leadconnectorhq.com/documents/download/abc", name: "IMG_1447.JPG", mime: "image/jpeg", size: 6037438 }]);
    assert.deepEqual(filesIn({ x: { url: "http://insecure.example/a.jpg" } }), []);
    assert.equal(displayValue(value), "1 file");
    assert.equal(displayValue(["Saturday Training", "Sunday Training"]), "Saturday Training, Sunday Training");
    assert.equal(displayValue(""), null);
  });
});

describe("three-way merge", () => {
  test("first sync fills blanks and records agreement", () => {
    assert.deepEqual(decideInbound("bidirectional", undefined, null, "175"), { action: "apply", value: "175" });
    assert.deepEqual(decideInbound("bidirectional", undefined, "175", "175"), { action: "agree", value: "175" });
  });

  test("a first sync that disagrees with existing dashboard data is a conflict, not an overwrite", () => {
    assert.deepEqual(decideInbound("bidirectional", undefined, "170", "175"), { action: "conflict", base: null, dashboard: "170", ghl: "175" });
  });

  test("GHL unchanged since the last sync does nothing (this ignores our own push echo)", () => {
    assert.deepEqual(decideInbound("bidirectional", "175", "180", "175"), { action: "none" });
  });

  test("GHL changed and the dashboard did not: apply", () => {
    assert.deepEqual(decideInbound("bidirectional", "175", "175", "178"), { action: "apply", value: "178" });
  });

  test("both changed differently: conflict; GHL-only fields just apply", () => {
    assert.equal(decideInbound("bidirectional", "175", "180", "178").action, "conflict");
    assert.deepEqual(decideInbound("ghl_only", "175", "180", "178"), { action: "apply", value: "178" });
  });

  test("blank GHL values never erase, and dashboard-only fields are never touched", () => {
    assert.deepEqual(decideInbound("bidirectional", "175", "175", null), { action: "none" });
    assert.deepEqual(decideInbound("dashboard_only", undefined, null, "x"), { action: "none" });
  });

  test("push only bidirectional fields the dashboard changed, never blanks", () => {
    assert.equal(shouldPush("bidirectional", "175", "180"), true);
    assert.equal(shouldPush("bidirectional", "175", "175"), false);
    assert.equal(shouldPush("bidirectional", "175", null), false);
    assert.equal(shouldPush("ghl_only", "175", "180"), false);
    assert.equal(shouldPush("bidirectional", undefined, "180"), true);
  });
});
