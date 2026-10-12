// Phase 11: applications fed from GoHighLevel. Run: npm run test:rls
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addMember, as, createDatabase, newUser, rejects, rowsAs, users } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;
const people = {};
let appId;

before(async () => {
  db = await createDatabase();
  people.booker = await addMember(db, newUser("booker"), "booker");
  people.admin = await addMember(db, newUser("admin"), "administrator");
  // The webhook writes with the secret key (service role), modelled here as the superuser.
  [{ id: appId }] = await su(`insert into public.applications
    (source, external_id, first_name, last_name, email, phone, date_of_birth, city, state, height_cm, waist_cm, hair_color, instagram,
     guardian_name, guardian_email, sms_consent, message, raw_payload)
    values ('ghl', 'contact-1', 'Saih', 'Tester', 'saih@example.test', '555-0100', current_date - interval '15 years', 'Dallas', 'TX',
     170, 70, 'Brown', '@saih', 'Pat Tester', 'pat@example.test', true, 'Hello', '{"secret":"raw"}') returning id`);
  await su("insert into public.application_photos (application_id, kind, storage_path) values ($1, 'headshot', $2)", [appId, `${appId}/headshot-1.jpg`]);
  await su("insert into storage.objects (bucket_id, name) values ('applications', $1)", [`${appId}/headshot-1.jpg`]);
});

describe("phase 11: application access", () => {
  test("anonymous visitors and roles without the permission see nothing", async () => {
    assert.deepEqual(await rowsAs(db, "anon", "select id from public.applications"), []);
    assert.deepEqual(await rowsAs(db, users.creative, "select id from public.applications"), []);
    assert.deepEqual(await rowsAs(db, users.creative, "select id from public.application_photos"), []);
    assert.deepEqual(await rowsAs(db, users.creative, "select name from storage.objects where bucket_id = 'applications'"), []);
  });

  test("readers see applications and photos but never the raw payload", async () => {
    const rows = await rowsAs(db, people.booker, "select id, is_minor from public.applications");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].is_minor, true, "minor derived from DOB");
    assert.ok(await rejects(db, people.booker, "select raw_payload from public.applications"));
    assert.equal((await rowsAs(db, people.booker, "select name from storage.objects where bucket_id = 'applications'")).length, 1);
  });

  test("nobody signed in can create applications or photos directly", async () => {
    assert.ok(await rejects(db, users.owner, "insert into public.applications (first_name) values ('Forged')"));
    assert.ok(await rejects(db, users.owner, `insert into public.application_photos (application_id, storage_path) values ('${appId}', 'x')`));
    assert.ok(await rejects(db, users.owner, "insert into storage.objects (bucket_id, name) values ('applications', 'forged.jpg')"));
  });

  test("readers without manage cannot change status or add notes", async () => {
    await rowsAs(db, people.booker, `update public.applications set status = 'rejected' where id = '${appId}'`);
    assert.equal((await su("select status from public.applications where id = $1", [appId]))[0].status, "new");
    assert.ok(await rejects(db, people.booker, `insert into public.application_notes (application_id, body) values ('${appId}', 'x')`));
  });

  test("managers review, annotate, and every status change is audited", async () => {
    await as(db, users.talentManager, `update public.applications set status = 'reviewing' where id = '${appId}'`);
    const [row] = await su("select status, reviewed_by from public.applications where id = $1", [appId]);
    assert.equal(row.status, "reviewing");
    assert.equal(row.reviewed_by, users.talentManager.id);
    await as(db, users.talentManager, `insert into public.application_notes (application_id, body) values ('${appId}', 'Great look')`);
    assert.ok(await rejects(db, users.talentManager, `insert into public.application_notes (application_id, body, author_id) values ('${appId}', 'x', '${users.owner.id}')`));
    const audit = await su("select action from public.audit_logs where entity_id = $1 order by created_at", [appId]);
    assert.deepEqual(audit.map((item) => item.action), ["application.received", "application.status_changed"]);
  });

  test("status cannot be set to converted by hand", async () => {
    assert.ok(await rejects(db, users.talentManager, `update public.applications set status = 'converted' where id = '${appId}'`));
    assert.ok(await rejects(db, users.talentManager, `update public.applications set email = 'x@example.test' where id = '${appId}'`));
  });
});

describe("phase 11: convert to talent", () => {
  test("roles without talent.create cannot convert", async () => {
    assert.ok(await rejects(db, people.booker, `select public.convert_application('${appId}')`));
  });

  test("conversion creates a private draft with the applicant's details", async () => {
    const { rows: [{ talent }] } = await as(db, users.talentManager, `select public.convert_application('${appId}') as talent`);
    const [t] = await su("select display_name, publication_status, show_on_website, is_minor, guardian_required, consent_status, location from public.talent where id = $1", [talent]);
    assert.deepEqual(t, { display_name: "Saih Tester", publication_status: "draft", show_on_website: false, is_minor: true, guardian_required: true, consent_status: "pending", location: "Dallas, TX" });
    const [pd] = await su("select email, mobile, allow_sms from public.talent_private_details where talent_id = $1", [talent]);
    assert.deepEqual(pd, { email: "saih@example.test", mobile: "555-0100", allow_sms: true });
    const [m] = await su("select height_cm::int as h, waist_cm::int as w, hair_color from public.talent_measurements where talent_id = $1", [talent]);
    assert.deepEqual(m, { h: 170, w: 70, hair_color: "Brown" });
    assert.equal((await su("select 1 from public.talent_contacts where talent_id = $1 and relationship = 'guardian'", [talent])).length, 1);
    assert.equal((await su("select 1 from public.talent_social_accounts where talent_id = $1 and handle = '@saih'", [talent])).length, 1);
    const [app] = await su("select status, converted_talent_id from public.applications where id = $1", [appId]);
    assert.equal(app.status, "converted");
    assert.equal(app.converted_talent_id, talent);
    assert.deepEqual(await rowsAs(db, "anon", `select id from public.public_talents_view where id = '${talent}'`), []);
    assert.equal((await su("select 1 from public.audit_logs where action = 'application.converted' and entity_id = $1", [appId])).length, 1);
  });

  test("converting twice returns the same talent", async () => {
    const first = (await su("select converted_talent_id from public.applications where id = $1", [appId]))[0].converted_talent_id;
    const { rows: [{ talent }] } = await as(db, users.talentManager, `select public.convert_application('${appId}') as talent`);
    assert.equal(talent, first);
  });
});

describe("phase 11: retention", () => {
  test("only the owner can purge, and only old rejected/archived applications go", async () => {
    const [{ id: oldRejected }] = await su("insert into public.applications (source, external_id, status, first_name) values ('ghl', 'old', 'rejected', 'Old') returning id");
    await su("update public.applications set updated_at = now() - interval '2 years' where id = $1", [oldRejected]);
    // prepare_application resets updated_at on update, so age it with the trigger disabled.
    await su("alter table public.applications disable trigger prepare_application");
    await su("update public.applications set updated_at = now() - interval '2 years' where id = $1", [oldRejected]);
    await su("alter table public.applications enable trigger prepare_application");
    assert.ok(await rejects(db, people.admin, "select * from public.purge_stale_applications()"));
    await as(db, users.owner, "select * from public.purge_stale_applications()");
    assert.equal((await su("select 1 from public.applications where id = $1", [oldRejected])).length, 0);
    assert.equal((await su("select 1 from public.applications where id = $1", [appId])).length, 1);
  });
});
