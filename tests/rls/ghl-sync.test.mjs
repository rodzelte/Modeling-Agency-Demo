// GHL sync (migration 026): mirror access, configuration rights, one talent per
// GHL contact, and the write-back queue. Run: npm run test:rls
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addMember, as, createDatabase, newUser, rejects, rowsAs, users } from "./harness.mjs";

let db;
// The sync writes with the secret key; modelled here as the superuser (no auth.uid()).
const su = async (sql, params) => (await db.query(sql, params)).rows;
const people = {};

before(async () => {
  db = await createDatabase();
  people.admin = await addMember(db, newUser("admin"), "administrator");
  people.booker = await addMember(db, newUser("booker"), "booker");
  await su(`insert into public.ghl_pipelines (id, name, purpose, badge_label, raw) values ('p-expo', 'Dallas Model and Talent Expo', 'talent', 'Model Expo', '{"secret":"raw"}')`);
  await su(`insert into public.ghl_pipeline_stages (id, pipeline_id, name, position, normalized_status, mapping_source) values ('s-enrolled', 'p-expo', 'Enrolled', 6, 'enrolled', 'initial')`);
  await su(`insert into public.ghl_field_definitions (id, object_key, name, field_key, data_type, target, ownership) values ('f-height', 'contact', 'Height', 'contact.height', 'TEXT', 'height_cm', 'bidirectional')`);
  await su(`insert into public.ghl_contacts (id, first_name, last_name, email, phone, custom_fields, raw, crm_status, programs)
    values ('c-1', 'Maya', 'Stone', 'maya@example.test', '(214) 555-0101', '{"f-height":"5ft 9"}', '{"raw":true}', 'enrolled', '{"Model Expo"}'),
           ('c-sib', 'Leo', 'Stone', 'maya@example.test', null, '{}', null, 'active', '{}')`);
  await su(`insert into public.ghl_opportunities (id, contact_id, pipeline_id, stage_id, status, raw) values ('o-1', 'c-1', 'p-expo', 's-enrolled', 'won', '{}')`);
});

describe("ghl sync: access", () => {
  test("anonymous visitors and roles without the permission see nothing", async () => {
    for (const table of ["ghl_contacts", "ghl_opportunities", "ghl_pipelines", "ghl_sync_jobs", "ghl_settings", "ghl_field_state"]) {
      assert.deepEqual(await rowsAs(db, "anon", `select * from public.${table}`), [], `anon ${table}`);
      assert.deepEqual(await rowsAs(db, users.creative, `select * from public.${table}`), [], `creative ${table}`);
      assert.deepEqual(await rowsAs(db, people.booker, `select * from public.${table}`), [], `booker ${table}`);
    }
  });

  test("talent managers read the mirror but never raw GHL payloads", async () => {
    const rows = await rowsAs(db, users.talentManager, "select id, crm_status, programs from public.ghl_contacts order by id");
    assert.deepEqual(rows.map((row) => row.id), ["c-1", "c-sib"]);
    assert.ok(await rejects(db, users.talentManager, "select raw from public.ghl_contacts"));
    assert.ok(await rejects(db, users.talentManager, "select raw from public.ghl_opportunities"));
    assert.ok(await rejects(db, users.talentManager, "select raw from public.ghl_pipelines"));
  });

  test("only integration managers change mappings, and each change is audited", async () => {
    await as(db, users.talentManager, "update public.ghl_pipeline_stages set normalized_status = 'active' where id = 's-enrolled'").catch(() => null);
    assert.equal((await su("select normalized_status from public.ghl_pipeline_stages where id = 's-enrolled'"))[0].normalized_status, "enrolled");
    await as(db, people.admin, "update public.ghl_pipeline_stages set normalized_status = 'active' where id = 's-enrolled'");
    const [stage] = await su("select normalized_status, mapping_source from public.ghl_pipeline_stages where id = 's-enrolled'");
    assert.deepEqual(stage, { normalized_status: "active", mapping_source: "staff" });
    await as(db, people.admin, "update public.ghl_pipelines set badge_label = 'Expo' where id = 'p-expo'");
    const audits = await su("select actor_id, entity_type from public.audit_logs where action = 'ghl.config_changed' order by created_at");
    assert.deepEqual(audits.map((row) => row.entity_type), ["ghl_pipeline_stages", "ghl_pipelines"]);
    assert.equal(audits[0].actor_id, people.admin.id);
    await as(db, people.admin, "update public.ghl_pipeline_stages set normalized_status = 'enrolled' where id = 's-enrolled'");
    await as(db, people.admin, "update public.ghl_pipelines set badge_label = 'Model Expo' where id = 'p-expo'");
  });

  test("staff cannot write the mirror or the queue, claim jobs, or set CRM status", async () => {
    assert.ok(await rejects(db, people.admin, "insert into public.ghl_contacts (id) values ('forged')"));
    assert.ok(await rejects(db, people.admin, "update public.ghl_contacts set crm_status = 'active' where id = 'c-1'"));
    assert.ok(await rejects(db, people.admin, "insert into public.ghl_sync_jobs (kind, external_id) values ('contact', 'c-1')"));
    assert.ok(await rejects(db, people.admin, "select * from public.ghl_claim_jobs(5)"));
    assert.ok(await rejects(db, people.admin, "update public.talent set crm_status = 'active'"));
  });

  test("CRM status and program tags are never visible to anonymous visitors", async () => {
    assert.ok(await rejects(db, "anon", "select crm_status from public.talent"));
    assert.ok(await rejects(db, "anon", "select crm_programs from public.talent"));
  });
});

describe("ghl sync: one talent per contact", () => {
  let mayaTalent;

  test("the sync creates a private draft talent once, with status and program tags", async () => {
    const [{ id }] = await su("select public.ghl_link_talent('c-1', true) as id");
    mayaTalent = id;
    const [talent] = await su("select first_name, last_name, publication_status, show_on_website, crm_status, crm_programs from public.talent where id = $1", [id]);
    assert.deepEqual(talent, { first_name: "Maya", last_name: "Stone", publication_status: "draft", show_on_website: false, crm_status: "enrolled", crm_programs: ["Model Expo"] });
    const [{ again }] = await su("select public.ghl_link_talent('c-1', true) as again");
    assert.equal(again, id, "running again links the same talent");
    assert.equal((await su("select count(*)::int as n from public.talent where first_name = 'Maya'"))[0].n, 1);
    assert.equal((await su("select count(*)::int as n from public.audit_logs where action = 'talent.created' and entity_id = $1", [id]))[0].n, 1);
  });

  test("a sibling sharing the parent's email is not merged into the same talent", async () => {
    await su("update public.talent_private_details set email = 'maya@example.test' where talent_id = $1", [mayaTalent]);
    const [{ id }] = await su("select public.ghl_link_talent('c-sib', false) as id");
    assert.equal(id, null, "different first name: no match, nothing created");
  });

  test("an existing talent with the same email and first name is linked, not duplicated", async () => {
    const [{ id: existing }] = await su("insert into public.talent (slug, first_name, last_name, display_name) values ('nia-x', 'Nia', 'Cole', 'Nia Cole') returning id");
    await su("insert into public.talent_private_details (talent_id, email) values ($1, 'NIA@example.test')", [existing]);
    await su("insert into public.ghl_contacts (id, first_name, last_name, email, crm_status) values ('c-nia', 'nia', 'Cole', 'nia@example.test', 'active')");
    const [{ id }] = await su("select public.ghl_link_talent('c-nia', true) as id");
    assert.equal(id, existing);
    assert.equal((await su("select count(*)::int as n from public.talent where lower(first_name) = 'nia'"))[0].n, 1);
  });

  test("an open application for the contact is closed, and converting later never duplicates", async () => {
    await su("insert into public.ghl_contacts (id, first_name, email, crm_status) values ('c-app', 'Ava', 'ava@example.test', 'active')");
    const [{ id: appId }] = await su("insert into public.applications (source, external_id, first_name, status) values ('ghl', 'c-app', 'Ava', 'approved') returning id");
    const [{ id: talentId }] = await su("select public.ghl_link_talent('c-app', true) as id");
    const [app] = await su("select status, converted_talent_id from public.applications where id = $1", [appId]);
    assert.deepEqual(app, { status: "converted", converted_talent_id: talentId });

    // Application converted first, contact synced afterwards: the converted talent is reused.
    await su("insert into public.ghl_contacts (id, first_name, email, crm_status) values ('c-app2', 'Ivy', 'ivy@example.test', 'active')");
    const [{ id: app2 }] = await su("insert into public.applications (source, external_id, first_name, status) values ('ghl', 'c-app2', 'Ivy', 'approved') returning id");
    const { rows: [{ converted }] } = await as(db, people.admin, `select public.convert_application('${app2}') as converted`);
    const [{ linked }] = await su("select talent_id as linked from public.ghl_contacts where id = 'c-app2'");
    assert.equal(linked, converted, "convert_application links the mirrored contact");
    const [{ again }] = await su("select public.ghl_link_talent('c-app2', true) as again");
    assert.equal(again, converted);
  });

  test("deleting a linked talent stops the sync from recreating it", async () => {
    const [{ id }] = await su("insert into public.talent (slug, first_name, last_name, display_name) values ('zoe-x', 'Zoe', 'X', 'Zoe') returning id");
    await su("insert into public.ghl_contacts (id, first_name, crm_status, talent_id) values ('c-zoe', 'Zoe', 'active', $1)", [id]);
    await su("delete from public.talent where id = $1", [id]);
    const [contact] = await su("select talent_id, auto_create_blocked from public.ghl_contacts where id = 'c-zoe'");
    assert.deepEqual(contact, { talent_id: null, auto_create_blocked: true });
  });

  test("staff need integrations.manage plus talent rights to create from a contact", async () => {
    await su("insert into public.ghl_contacts (id, first_name, crm_status) values ('c-staff', 'Kai', 'screening')");
    assert.ok(await rejects(db, users.talentManager, "select public.ghl_link_talent('c-staff', true)"));
    const { rows: [{ id }] } = await as(db, people.admin, "select public.ghl_link_talent('c-staff', true) as id");
    assert.ok(id);
    const [audit] = await su("select actor_id from public.audit_logs where action = 'talent.created' and entity_id = $1", [id]);
    assert.equal(audit.actor_id, people.admin.id);
  });
});

describe("ghl sync: write-back queue", () => {
  test("nothing is queued while write-back is off", async () => {
    const [{ talent_id: id }] = await su("select talent_id from public.ghl_contacts where id = 'c-1'");
    await as(db, people.admin, `update public.talent_private_details set mobile = '555-0199' where talent_id = '${id}'`);
    assert.equal((await su("select count(*)::int as n from public.ghl_sync_jobs"))[0].n, 0);
  });

  test("staff edits queue one push per contact; sync writes never do", async () => {
    await su("update public.ghl_settings set writeback_enabled = true");
    const [{ talent_id: id }] = await su("select talent_id from public.ghl_contacts where id = 'c-1'");
    await as(db, people.admin, `update public.talent_private_details set mobile = '555-0200' where talent_id = '${id}'`);
    await as(db, people.admin, `insert into public.talent_measurements (talent_id, height_cm) values ('${id}', 176)`);
    const jobs = await su("select kind, external_id, status from public.ghl_sync_jobs");
    assert.deepEqual(jobs, [{ kind: "push_contact", external_id: "c-1", status: "pending" }], "repeat edits collapse into one job");

    await su("update public.ghl_sync_jobs set status = 'done'");
    await su("update public.talent_private_details set mobile = '555-0300' where talent_id = $1", [id]);
    assert.equal((await su("select count(*)::int as n from public.ghl_sync_jobs where status = 'pending'"))[0].n, 0, "sync writes do not echo back");
    await su("update public.ghl_settings set writeback_enabled = false");
  });

  test("claiming jobs is atomic and retries stale running jobs", async () => {
    await su("insert into public.ghl_sync_jobs (kind, external_id) values ('contact', 'c-1'), ('contact', 'c-nia')");
    const first = await su("select external_id from public.ghl_claim_jobs(10) order by external_id");
    assert.deepEqual(first.map((row) => row.external_id), ["c-1", "c-nia"]);
    assert.deepEqual(await su("select * from public.ghl_claim_jobs(10)"), [], "running jobs are not claimed twice");
    await su("update public.ghl_sync_jobs set updated_at = now() - interval '11 minutes' where external_id = 'c-1' and status = 'running'");
    const [stale] = await su("select external_id, attempts from public.ghl_claim_jobs(10)");
    assert.deepEqual(stale, { external_id: "c-1", attempts: 2 });
  });
});

describe("migration 033: queueing GHL contacts", () => {
  test("queueing an already-queued contact is skipped, not an error; staff cannot call it", async () => {
    const [{ n: first }] = await su("select public.ghl_enqueue_jobs('contact', array['q-1', 'q-2', 'q-1'], 'test') as n");
    assert.equal(first, 2);
    const [{ n: again }] = await su("select public.ghl_enqueue_jobs('contact', array['q-1', 'q-3'], 'test') as n");
    assert.equal(again, 1, "q-1 is already open, only q-3 is new");
    await su("update public.ghl_sync_jobs set status = 'failed', next_attempt_at = now() + interval '1 hour' where external_id = 'q-2'");
    await su("select public.ghl_enqueue_jobs('contact', array['q-2'], 'test')");
    const [due] = await su("select next_attempt_at <= now() as due from public.ghl_sync_jobs where external_id = 'q-2'");
    assert.equal(due.due, true, "a failed job queued again is due now");
    assert.ok(await rejects(db, people.admin, "select public.ghl_enqueue_jobs('contact', array['x'], null)"));
  });
});
