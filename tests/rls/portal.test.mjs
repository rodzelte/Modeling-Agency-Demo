// Phase 15: talent portal isolation, change requests, digitals, documents.
// Run: npm run test:rls
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addMember, as, createDatabase, newUser, rejects, rowsAs, users } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;
const people = {};
let talentA;
let talentB;

before(async () => {
  db = await createDatabase();
  talentA = (await su("insert into public.talent (slug, first_name, last_name, display_name) values ('portal-a', 'Ana', 'A', 'Ana') returning id"))[0].id;
  talentB = (await su("insert into public.talent (slug, first_name, last_name, display_name) values ('portal-b', 'Ben', 'B', 'Ben') returning id"))[0].id;
  await su("insert into public.talent_private_details (talent_id, email, mobile, notes, minimum_day_rate) values ($1, 'ana@example.test', '555-0001', 'Internal: difficult client history', 900), ($2, 'ben@example.test', '555-0002', 'B note', 500)", [talentA, talentB]);
  await su("insert into public.talent_measurements (talent_id, height_cm, waist_cm) values ($1, 170, 66)", [talentA]);
  await su("insert into public.talent_notes (talent_id, body) values ($1, 'Staff-only note')", [talentA]);
  await su("insert into public.talent_banking (talent_id, account_name, account_number) values ($1, 'Ana', '000111222')", [talentA]);
  people.manager = users.talentManager;
  // Invited through the staff function, then the talent signs up and confirms.
  await as(db, people.manager, `select public.invite_talent_to_portal('${talentA}', 'Ana.Portal@example.test')`);
  people.a = newUser("ana-portal");
  people.a.email = "ana.portal@example.test";
  await su("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [people.a.id, people.a.email]);
  people.b = await addMember(db, newUser("ben"), "talent", talentB);
});

describe("phase 15: portal isolation", () => {
  test("invitation binds the login to exactly one talent", async () => {
    const [member] = await su("select role, talent_id, user_id from public.agency_members where lower(email) = 'ana.portal@example.test'");
    assert.equal(member.role, "talent");
    assert.equal(member.talent_id, talentA);
    assert.equal(member.user_id, people.a.id);
    assert.ok(await rejects(db, users.creative, `select public.invite_talent_to_portal('${talentB}', 'x@example.test')`));
  });

  test("portal_profile returns only the caller's allow-listed fields", async () => {
    const { rows: [{ p }] } = await as(db, people.a, "select public.portal_profile() as p");
    assert.equal(p.id, talentA);
    assert.equal(p.contact.email, "ana@example.test");
    assert.equal(p.measurements.height_cm, 170);
    const text = JSON.stringify(p);
    assert.ok(!text.includes("difficult") && !text.includes("900"), "notes and rates never appear");
    assert.equal((await as(db, users.owner, "select public.portal_profile() as p")).rows[0].p, null, "staff have no portal profile");
  });

  test("talent cannot read private details, notes, banking or the other talent", async () => {
    assert.deepEqual(await rowsAs(db, people.a, "select notes from public.talent_private_details"), []);
    assert.deepEqual(await rowsAs(db, people.a, "select body from public.talent_notes"), []);
    assert.deepEqual(await rowsAs(db, people.a, "select account_number from public.talent_banking"), []);
    const talent = await rowsAs(db, people.a, "select id from public.talent");
    assert.deepEqual(talent.map((row) => row.id), [talentA]);
    assert.deepEqual(await rowsAs(db, people.a, `select id from public.talent_measurements where talent_id = '${talentB}'`), []);
  });

  test("talent cannot edit their record directly", async () => {
    await rowsAs(db, people.a, `update public.talent set display_name = 'Hacked' where id = '${talentA}'`);
    assert.equal((await su("select display_name from public.talent where id = $1", [talentA]))[0].display_name, "Ana");
    assert.ok(await rejects(db, people.a, `insert into public.talent_measurements (talent_id, height_cm) values ('${talentA}', 200)`));
  });
});

describe("phase 15: change requests", () => {
  test("talent request changes for themselves only, with allowed fields", async () => {
    await as(db, people.a, `insert into public.talent_change_requests (talent_id, field_group, changes) values ('${talentA}', 'contact', '{"mobile":"555-7777"}')`);
    assert.ok(await rejects(db, people.a, `insert into public.talent_change_requests (talent_id, field_group, changes) values ('${talentB}', 'contact', '{"mobile":"1"}')`));
    assert.ok(await rejects(db, people.a, `insert into public.talent_change_requests (talent_id, field_group, changes) values ('${talentA}', 'contact', '{"notes":"x"}')`));
    assert.ok(await rejects(db, people.a, `insert into public.talent_change_requests (talent_id, field_group, changes, status) values ('${talentA}', 'social', '{"instagram":"@a"}', 'approved')`) === false);
    const statuses = (await su("select status from public.talent_change_requests where talent_id = $1 order by created_at", [talentA])).map((row) => row.status);
    assert.deepEqual(statuses, ["pending", "pending"], "status is always forced to pending on insert");
    assert.deepEqual(await rowsAs(db, people.b, "select id from public.talent_change_requests"), []);
  });

  test("talent cannot approve their own request", async () => {
    const [req] = await su("select id from public.talent_change_requests where field_group = 'contact'");
    assert.ok(await rejects(db, people.a, `select public.apply_change_request('${req.id}', true)`));
    await rowsAs(db, people.a, `update public.talent_change_requests set status = 'approved' where id = '${req.id}'`);
    assert.equal((await su("select status from public.talent_change_requests where id = $1", [req.id]))[0].status, "pending");
  });

  test("staff approval applies the change and is audited", async () => {
    const [req] = await su("select id from public.talent_change_requests where field_group = 'contact'");
    await as(db, people.manager, `select public.apply_change_request('${req.id}', true, 'Thanks')`);
    assert.equal((await su("select mobile from public.talent_private_details where talent_id = $1", [talentA]))[0].mobile, "555-7777");
    assert.equal((await su("select status from public.talent_change_requests where id = $1", [req.id]))[0].status, "approved");
    assert.ok(await rejects(db, people.manager, `select public.apply_change_request('${req.id}', true)`), "cannot apply twice");
    assert.equal((await su("select 1 from public.audit_logs where action = 'portal.change_approved' and entity_id = $1", [talentA])).length, 1);
  });

  test("measurement approvals add history instead of overwriting", async () => {
    const { rows: [req] } = await as(db, people.a, `insert into public.talent_change_requests (talent_id, field_group, changes) values ('${talentA}', 'measurements', '{"waist_cm":64}') returning id`);
    await as(db, people.manager, `select public.apply_change_request('${req.id}', true)`);
    const rows = await su("select height_cm::int as h, waist_cm::int as w from public.talent_measurements where talent_id = $1 order by created_at", [talentA]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], { h: 170, w: 64 });
  });
});

describe("phase 15: digitals, availability, documents", () => {
  test("talent upload pending digitals to their own portal folder only", async () => {
    await as(db, people.a, `insert into public.talent_photos (talent_id, storage_path, storage_bucket, "public", uploaded_by_talent, review_status) values ('${talentA}', 'talent/${talentA}/portal/d1.jpg', 'talent-private', false, true, 'pending')`);
    assert.ok(await rejects(db, people.a, `insert into public.talent_photos (talent_id, storage_path, storage_bucket, "public", uploaded_by_talent, review_status) values ('${talentA}', 'talent/${talentA}/portal/d2.jpg', 'talent-private', true, true, 'pending')`));
    assert.ok(await rejects(db, people.a, `insert into public.talent_photos (talent_id, storage_path, storage_bucket, uploaded_by_talent, review_status) values ('${talentA}', 'talent/${talentA}/portal/d3.jpg', 'talent-private', true, 'approved')`));
    assert.ok(await rejects(db, people.a, `insert into public.talent_photos (talent_id, storage_path, storage_bucket, uploaded_by_talent, review_status) values ('${talentB}', 'talent/${talentB}/portal/x.jpg', 'talent-private', true, 'pending')`));
    await as(db, people.a, `insert into storage.objects (bucket_id, name) values ('talent-private', 'talent/${talentA}/portal/d1.jpg')`);
    assert.ok(await rejects(db, people.a, `insert into storage.objects (bucket_id, name) values ('talent-private', 'talent/${talentB}/portal/x.jpg')`));
    assert.ok(await rejects(db, people.a, `insert into storage.objects (bucket_id, name) values ('talent-private', 'talent/${talentA}/other.jpg')`));
  });

  test("pending photos cannot be made public until approved", async () => {
    assert.ok(await rejects(db, users.creative, `update public.talent_photos set "public" = true, public_storage_path = 'x' where storage_path like '%/portal/d1.jpg'`));
    await as(db, users.creative, "update public.talent_photos set review_status = 'approved' where storage_path like '%/portal/d1.jpg'");
    await as(db, users.creative, `update public.talent_photos set "public" = true, public_storage_path = 'talent/x/d1.jpg' where storage_path like '%/portal/d1.jpg'`);
  });

  test("availability is private to the talent and staff", async () => {
    await as(db, people.a, `insert into public.talent_availability (talent_id, start_on, end_on, note) values ('${talentA}', '2026-12-20', '2026-12-31', 'Holiday')`);
    assert.ok(await rejects(db, people.a, `insert into public.talent_availability (talent_id, start_on, end_on) values ('${talentB}', '2026-12-20', '2026-12-31')`));
    assert.deepEqual(await rowsAs(db, people.b, "select id from public.talent_availability"), []);
    assert.equal((await rowsAs(db, users.readOnly, "select id from public.talent_availability")).length, 1);
  });

  test("only documents shared with the talent are visible to them", async () => {
    await su(`insert into public.talent_documents (talent_id, file_name, storage_path, shared_with_talent) values
      ($1, 'contract.pdf', 'talent/${talentA}/contract.pdf', true), ($1, 'internal.pdf', 'talent/${talentA}/internal.pdf', false)`, [talentA]);
    await su("insert into storage.objects (bucket_id, name) values ('talent-documents', $1), ('talent-documents', $2)", [`talent/${talentA}/contract.pdf`, `talent/${talentA}/internal.pdf`]);
    assert.deepEqual((await rowsAs(db, people.a, "select file_name from public.talent_documents")).map((row) => row.file_name), ["contract.pdf"]);
    assert.deepEqual((await rowsAs(db, people.a, "select name from storage.objects where bucket_id = 'talent-documents'")).map((row) => row.name), [`talent/${talentA}/contract.pdf`]);
    assert.deepEqual(await rowsAs(db, people.b, "select file_name from public.talent_documents"), []);
  });

  test("revoking portal access suspends the login", async () => {
    await as(db, people.manager, `select public.revoke_talent_portal('${talentA}')`);
    assert.deepEqual(await rowsAs(db, people.a, "select id from public.talent"), []);
    assert.equal((await as(db, people.a, "select public.portal_profile() as p")).rows[0].p, null);
  });
});
