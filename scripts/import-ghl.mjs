// Imports existing GoHighLevel data into applications, through the same webhook
// the live GHL workflow uses (so mapping, de-duplication and photo handling are
// identical). Safe to re-run: one application per GHL contact, so someone who
// filled in several forms ends up as one application with all their answers.
//
// Dry run by default. See docs/ghl-integration.md for creating the token.
//
//   node --env-file=.env.local scripts/import-ghl.mjs --list-forms         # show every form and survey with its id
//   node --env-file=.env.local scripts/import-ghl.mjs                      # list what would be sent
//   node --env-file=.env.local scripts/import-ghl.mjs --apply              # send everything
//   node --env-file=.env.local scripts/import-ghl.mjs --form=abc,def       # only these forms (overrides GHL_FORM_ID)
//   node --env-file=.env.local scripts/import-ghl.mjs --source=contacts --tag=join-us --apply
//
// Signed models (contacts in a pipeline stage), arriving approved and ready for
// Dashboard → Applications → "Convert all approved":
//   node --env-file=.env scripts/import-ghl.mjs --stage="Active Talent" --signed            # dry run
//   node --env-file=.env scripts/import-ghl.mjs --stage="Active Talent" --signed --apply
//   (--pipeline="Talent Recruitment Pipeline" is the default pipeline)
//
// Environment:
//   GHL_API_TOKEN        Private Integration token (Settings → Private Integrations),
//                        scopes: contacts.readonly, forms.readonly, surveys.readonly, locations/customFields.readonly,
//                        opportunities.readonly (for --stage)
//   GHL_LOCATION_ID      Sub-account (location) id
//   GHL_FORM_ID          Form id(s) of the registration forms, comma-separated
//   GHL_SURVEY_ID        Survey id(s), comma-separated (optional; for funnels built with surveys)
//   GHL_WEBHOOK_SECRET   Same secret as the deployed site
//   IMPORT_TARGET_URL    e.g. https://42modelmanagement.com/api/integrations/ghl
const API = "https://services.leadconnectorhq.com";
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : true];
}));
const ids = (value) => (typeof value === "string" ? value : "").split(",").map((id) => id.trim()).filter(Boolean);
const apply = Boolean(args.apply);
const listOnly = Boolean(args["list-forms"]);
const limit = args.limit ? Number(args.limit) : Infinity;

// --form / --survey replace both env lists ("only these"). --source=surveys (older usage) treats the form ids as survey ids.
const picked = typeof args.form === "string" || typeof args.survey === "string";
let formIds = ids(picked ? args.form : process.env.GHL_FORM_ID);
let surveyIds = ids(picked ? args.survey : process.env.GHL_SURVEY_ID);
if (args.source === "surveys" && !surveyIds.length) [formIds, surveyIds] = [[], formIds];
const stageName = typeof args.stage === "string" ? args.stage : null;
const pipelineName = typeof args.pipeline === "string" ? args.pipeline : "Talent Recruitment Pipeline";
// --signed: these people are already signed, so the site approves them on arrival.
const signed = Boolean(args.signed);
const source = stageName ? "pipeline"
  : args.source === "contacts" || (!args.source && !formIds.length && !surveyIds.length) ? "contacts" : "submissions";

const required = ["GHL_API_TOKEN", "GHL_LOCATION_ID", ...(apply && !listOnly ? ["GHL_WEBHOOK_SECRET", "IMPORT_TARGET_URL"] : [])];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
if (source === "submissions" && !formIds.length && !surveyIds.length) {
  console.error("No form ids: set GHL_FORM_ID (comma-separated) or pass --form=id1,id2. Run with --list-forms to see them.");
  process.exit(1);
}
const { GHL_API_TOKEN, GHL_LOCATION_ID, GHL_WEBHOOK_SECRET, IMPORT_TARGET_URL } = process.env;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ghl(path, params = {}) {
  const url = new URL(path, API);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${GHL_API_TOKEN}`, Version: "2021-07-28", Accept: "application/json" } });
    if (response.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!response.ok) throw new Error(`GHL ${path} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    return response.json();
  }
  throw new Error(`GHL ${path} kept rate-limiting`);
}

// Every form or survey in the location, as { id, name }.
async function catalogue(kind) {
  const items = [];
  for (let skip = 0; ; skip += 50) {
    const data = await ghl(`/${kind}/`, { locationId: GHL_LOCATION_ID, limit: 50, skip });
    const rows = data[kind] ?? [];
    items.push(...rows.map((row) => ({ id: row.id ?? row._id, name: row.name ?? "(unnamed)" })));
    if (rows.length < 50 || (data.total && items.length >= data.total)) return items;
  }
}

if (listOnly) {
  for (const kind of ["forms", "surveys"]) {
    try {
      const items = await catalogue(kind);
      console.log(`\n${kind === "forms" ? "Forms" : "Surveys"} (${items.length}):`);
      for (const item of items) console.log(`  ${item.id}  ${item.name}`);
    } catch (error) {
      console.error(`\n${kind}: ${error.message}`);
    }
  }
  console.log(`\nPut the ones used for Join Us in .env.local, comma-separated: GHL_FORM_ID=id1,id2 (and GHL_SURVEY_ID for surveys).`);
  process.exit(0);
}

// id → label and fieldKey → label, so custom fields arrive under readable names.
async function fieldNames() {
  const names = {};
  const { customFields = [] } = await ghl(`/locations/${GHL_LOCATION_ID}/customFields`);
  for (const field of customFields) {
    names[field.id] = field.name;
    if (field.fieldKey) names[field.fieldKey] = field.name;
  }
  return names;
}

async function formNames() {
  const names = {};
  for (const kind of ["forms", "surveys"]) {
    try {
      for (const item of await catalogue(kind)) names[item.id] = item.name;
    } catch {
      // Only used to label the source form; ids are shown instead.
    }
  }
  return names;
}

async function* submissions(kind, id, label) {
  for (let page = 1; ; page += 1) {
    const data = await ghl(`/${kind}/submissions`, { locationId: GHL_LOCATION_ID, [kind === "surveys" ? "surveyId" : "formId"]: id, page, limit: 100 });
    const rows = data.submissions ?? [];
    for (const row of rows) {
      // "Submitted via" is kept under Other answers, so staff can see which form it came from.
      yield { contact_id: row.contactId, full_name: row.name, email: row.email, date_submitted: row.createdAt, submitted_via: label, ...(row.others ?? {}) };
    }
    if (!rows.length || !data.meta?.nextPage) return;
  }
}

async function* allSubmissions(labels) {
  for (const id of formIds) yield* submissions("forms", id, labels[id] ?? `form ${id}`);
  for (const id of surveyIds) yield* submissions("surveys", id, labels[id] ?? `survey ${id}`);
}

const contactPayload = (contact) => ({
  contact_id: contact.id, first_name: contact.firstName, last_name: contact.lastName, email: contact.email, phone: contact.phone,
  date_of_birth: contact.dateOfBirth, address1: contact.address1, city: contact.city, state: contact.state,
  postal_code: contact.postalCode, country: contact.country, tags: (contact.tags ?? []).join(", "),
  date_submitted: contact.dateAdded, customFields: contact.customFields ?? [],
});

async function* contacts(tag) {
  let startAfter; let startAfterId;
  for (;;) {
    const data = await ghl("/contacts/", { locationId: GHL_LOCATION_ID, limit: 100, startAfter, startAfterId });
    const rows = data.contacts ?? [];
    for (const contact of rows) {
      if (tag && !(contact.tags ?? []).map((item) => String(item).toLowerCase()).includes(String(tag).toLowerCase())) continue;
      yield contactPayload(contact);
    }
    if (!rows.length || !data.meta?.startAfterId) return;
    ({ startAfter, startAfterId } = data.meta);
  }
}

// Contacts whose opportunity sits in one pipeline stage (e.g. Active Talent).
async function* pipelineStage() {
  const { pipelines = [] } = await ghl("/opportunities/pipelines", { locationId: GHL_LOCATION_ID });
  const pipeline = pipelines.find((item) => item.name.trim().toLowerCase() === pipelineName.trim().toLowerCase());
  if (!pipeline) throw new Error(`No pipeline named "${pipelineName}". Pipelines: ${pipelines.map((item) => item.name).join(", ")}`);
  const stage = pipeline.stages.find((item) => item.name.trim().toLowerCase() === stageName.trim().toLowerCase());
  if (!stage) throw new Error(`No stage "${stageName}" in "${pipeline.name}". Stages: ${pipeline.stages.map((item) => item.name).join(", ")}`);
  const done = new Set();
  let startAfter; let startAfterId;
  for (;;) {
    const data = await ghl("/opportunities/search", { location_id: GHL_LOCATION_ID, pipeline_id: pipeline.id, pipeline_stage_id: stage.id, limit: 100, startAfter, startAfterId });
    const rows = data.opportunities ?? [];
    for (const opportunity of rows) {
      if (!opportunity.contactId || done.has(opportunity.contactId)) continue;
      done.add(opportunity.contactId);
      const { contact } = await ghl(`/contacts/${opportunity.contactId}`);
      yield { ...contactPayload(contact), pipeline_stage: `${pipeline.name} → ${stage.name}` };
    }
    if (rows.length < 100 || !data.meta?.startAfterId) return;
    ({ startAfter, startAfterId } = data.meta);
  }
}

const names = await fieldNames();
const labels = source === "submissions" ? await formNames() : {};
const stream = source === "pipeline" ? pipelineStage() : source === "contacts" ? contacts(args.tag) : allSubmissions(labels);
const summary = { seen: 0, sent: 0, created: 0, updated: 0, failed: 0, contacts: 0 };
const seenContacts = new Set();
const describe = source === "pipeline" ? `pipeline "${pipelineName}", stage "${stageName}"`
  : source === "contacts" ? `contacts${args.tag ? ` (tag ${args.tag})` : ""}`
  : [...formIds.map((id) => `form "${labels[id] ?? id}"`), ...surveyIds.map((id) => `survey "${labels[id] ?? id}"`)].join(", ");
console.log(`Source: ${describe}${signed ? " (signed models: arrive approved)" : ""}. ${apply ? "Sending to " + IMPORT_TARGET_URL : "Dry run (pass --apply to send)."}`);

for await (const payload of stream) {
  if (summary.seen >= limit) break;
  summary.seen += 1;
  const who = payload.contact_id ?? payload.email ?? "(no id)";
  seenContacts.add(who);
  const via = payload.submitted_via ? ` [${payload.submitted_via}]` : "";
  if (!apply) {
    const fields = Object.keys(payload).filter((key) => payload[key] !== undefined && payload[key] !== "" && key !== "customFields").map((key) => names[key] ?? key);
    console.log(`  - ${who}${via}: ${fields.length} fields${payload.customFields?.length ? ` + ${payload.customFields.length} custom` : ""}`);
    continue;
  }
  try {
    const response = await fetch(IMPORT_TARGET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": GHL_WEBHOOK_SECRET },
      body: JSON.stringify({ ...payload, _fieldNames: names, ...(signed ? { _intake: "signed_talent" } : {}) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    summary.sent += 1;
    summary[result.status === "created" ? "created" : "updated"] += 1;
    console.log(`  ✓ ${who}${via} → ${result.status} (${result.photos ?? 0} photo(s))`);
  } catch (error) {
    summary.failed += 1;
    console.error(`  ✗ ${who}${via}: ${error.message}`);
  }
  await sleep(250);
}

summary.contacts = seenContacts.size;
console.log(JSON.stringify(summary));
if (summary.failed) process.exit(1);
