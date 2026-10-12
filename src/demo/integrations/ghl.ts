// A stand-in for the GoHighLevel API in demo mode. The real sync engine runs
// unchanged; where it would call GHL it gets answers built from the sandbox's
// own mirror tables (the sample CRM data), plus an occasional new sample lead so
// "Run sync now" visibly does something. No request leaves this process, and
// "write-back" updates are acknowledged without being sent anywhere.
import { lit, runAsSystem } from "../sandbox/database.ts";

type Query = Record<string, string | number | undefined>;
type Row = Record<string, unknown>;

class DemoGhlError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function rows(sql: string): Promise<Row[]> {
  return runAsSystem(async (tx) => JSON.parse((await tx.query<{ body: string }>(`select coalesce(json_agg(row_to_json(_r)), '[]')::text as body from (${sql}) _r`)).rows[0].body) as Row[]);
}

// Fictional leads that "arrive" in GHL over time, one per sync.
const NEW_LEADS = [
  { id: "demoLead0000000000000001", firstName: "Reuben", lastName: "Halvorsen", email: "reuben.halvorsen@inbox-demo.example", phone: "+1 214 555 0171", city: "Dallas", state: "TX", tags: ["website form"] },
  { id: "demoLead0000000000000002", firstName: "Priscila", lastName: "Duarte", email: "priscila.duarte@inbox-demo.example", phone: "+1 817 555 0172", city: "Fort Worth", state: "TX", tags: ["open call"] },
  { id: "demoLead0000000000000003", firstName: "Callum", lastName: "Everhart", email: "callum.everhart@inbox-demo.example", phone: "+1 512 555 0173", city: "Austin", state: "TX", tags: ["website form"] },
  { id: "demoLead0000000000000004", firstName: "Greta", lastName: "Lindahl", email: "greta.lindahl@inbox-demo.example", phone: "+1 469 555 0174", city: "Plano", state: "TX", tags: ["referral"] },
];

function leadContact(lead: (typeof NEW_LEADS)[number]) {
  const now = new Date().toISOString();
  return { ...lead, type: "lead", source: "Demo lead", country: "US", dateAdded: now, dateUpdated: now, customFields: [] };
}

function contactFrom(row: Row, fileFields: Set<string>) {
  const custom = (row.custom_fields ?? {}) as Record<string, unknown>;
  return {
    id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, dateOfBirth: row.date_of_birth,
    type: row.contact_type, source: row.source, tags: row.tags ?? [], assignedTo: row.assigned_to, address1: row.address_1, city: row.city,
    state: row.state, postalCode: row.postal_code, country: row.country, dateAdded: row.source_created_at, dateUpdated: row.source_updated_at,
    // Uploaded-file fields are left out: the demo never downloads from anywhere.
    customFields: Object.entries(custom).filter(([id]) => !fileFields.has(id)).map(([id, value]) => ({ id, value })),
  };
}

const opportunityFrom = (row: Row) => ({
  id: row.id, name: row.name, monetaryValue: row.monetary_value === null ? null : Number(row.monetary_value), pipelineId: row.pipeline_id,
  pipelineStageId: row.stage_id, status: row.status, source: row.source, assignedTo: row.assigned_to, contactId: row.contact_id,
  createdAt: row.source_created_at, updatedAt: row.source_updated_at, lastStageChangeAt: row.last_stage_change_at,
  lastStatusChangeAt: row.last_status_change_at, customFields: [],
});

async function fileFieldIds() {
  return new Set((await rows("select id from public.ghl_field_definitions where upper(coalesce(data_type, '')) like '%FILE%' or target like 'photo_%'")).map((row) => String(row.id)));
}

export async function demoGhlRequest<T>(method: "GET" | "POST" | "PUT", path: string, options: { query?: Query; body?: unknown } = {}): Promise<T> {
  const answer = (value: unknown) => value as T;

  if (method === "GET" && path === "/opportunities/pipelines") {
    const pipelines = await rows("select id, name from public.ghl_pipelines where removed_at is null order by name");
    const stages = await rows("select id, pipeline_id, name, position from public.ghl_pipeline_stages where removed_at is null order by position");
    return answer({ pipelines: pipelines.map((pipeline) => ({ ...pipeline, stages: stages.filter((stage) => stage.pipeline_id === pipeline.id).map(({ id, name, position }) => ({ id, name, position })) })) });
  }
  if (method === "GET" && /^\/locations\/[^/]+\/customFields$/.test(path)) {
    const fields = await rows("select id, name, field_key, data_type, object_key, options from public.ghl_field_definitions where removed_at is null order by name");
    return answer({ customFields: fields.map((field) => ({ id: field.id, name: field.name, fieldKey: field.field_key ?? undefined, dataType: field.data_type ?? undefined, model: field.object_key, picklistOptions: field.options ?? undefined })) });
  }
  if (method === "GET" && /^\/locations\/[^/]+\/customValues$/.test(path)) {
    const values = await rows("select id, name, field_key, value from public.ghl_custom_values where removed_at is null order by name");
    return answer({ customValues: values.map((value) => ({ id: value.id, name: value.name, fieldKey: value.field_key ?? undefined, value: value.value ?? undefined })) });
  }
  if (method === "GET" && path === "/users/") {
    const users = await rows("select id, name, email, role from public.ghl_users where removed_at is null order by name");
    return answer({ users: users.map((user) => ({ id: user.id, name: user.name ?? undefined, email: user.email ?? undefined, roles: { role: user.role ?? undefined } })) });
  }
  if (method === "POST" && path === "/contacts/search") {
    const contacts = await rows("select * from public.ghl_contacts where removed_at is null order by source_updated_at desc nulls last limit 99");
    const known = new Set((await rows("select id from public.ghl_contacts")).map((row) => String(row.id)));
    const arriving = NEW_LEADS.find((lead) => !known.has(lead.id));
    const list = [...(arriving ? [leadContact(arriving)] : []), ...contacts.map((row) => contactFrom(row, new Set()))];
    return answer({ contacts: list, total: list.length });
  }
  if (method === "GET" && path === "/opportunities/search") {
    if (Number(options.query?.page ?? 1) > 1) return answer({ opportunities: [], meta: { total: 0 } });
    const contactId = options.query?.contact_id;
    const found = await rows(`select * from public.ghl_opportunities where removed_at is null${contactId ? ` and contact_id = ${lit(contactId)}` : ""} order by source_updated_at desc nulls last limit 99`);
    return answer({ opportunities: found.map(opportunityFrom), meta: { total: found.length } });
  }
  const contactPath = /^\/contacts\/([^/]+)$/.exec(path);
  if (contactPath) {
    const id = decodeURIComponent(contactPath[1]);
    if (method === "PUT") {
      console.info(JSON.stringify({ level: "info", scope: "demo", message: "GHL write-back simulated (nothing sent)", contact: id, at: new Date().toISOString() }));
      return answer({ contact: { id } });
    }
    const lead = NEW_LEADS.find((candidate) => candidate.id === id);
    const [row] = await rows(`select * from public.ghl_contacts where id = ${lit(id)} and removed_at is null`);
    if (row) return answer({ contact: contactFrom(row, await fileFieldIds()) });
    if (lead) return answer({ contact: leadContact(lead) });
    throw new DemoGhlError(`GHL GET ${path} failed with 404: Contact not found`, 404);
  }
  throw new DemoGhlError(`GHL ${method} ${path} is not simulated in demo mode`, 0);
}
