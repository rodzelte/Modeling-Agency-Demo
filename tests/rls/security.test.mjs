// RLS / privilege regression suite. Run: npm run test:rls
// RLS_UPTO=8 npm run test:rls reproduces the pre-009 vulnerabilities (expected to fail).
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { as, createDatabase, ids, rejects, rowsAs, users } from "./harness.mjs";

const upto = process.env.RLS_UPTO ? Number(process.env.RLS_UPTO) : undefined;
let db;
const superuser = async (sql, params) => (await db.query(sql, params)).rows;

before(async () => {
  db = await createDatabase({ upto });
});

describe("anonymous visitors", () => {
  const privateTables = ["profiles", "profile_roles", "roles", "agency_members", "talent", "talent_photos", "talent_measurements", "talent_banking", "talent_legal", "talent_medical", "talent_private_details", "audit_log", "audit_logs"];
  for (const table of privateTables) {
    test(`cannot read ${table}`, async () => {
      assert.deepEqual(await rowsAs(db, "anon", `select * from public.${table}`), []);
    });
  }

  test("cannot write audit_log", async () => {
    await rowsAs(db, "anon", "insert into public.audit_log (table_name, action) values ('x', 'forged')");
    assert.equal((await superuser("select count(*)::int as n from public.audit_log where action = 'forged'"))[0].n, 0);
  });

  test("public talents view exposes no DOB or legal names and hides drafts", async () => {
    const rows = await rowsAs(db, "anon", "select * from public.public_talents_view");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].slug, "saih-test");
    for (const column of ["date_of_birth", "first_name", "last_name", "talent_id", "mobile", "email"]) assert.ok(!(column in rows[0]), `${column} exposed`);
    assert.equal(rows[0].age, null, "age must be opt-in");
  });

  test("public media view exposes only promoted public images", async () => {
    const rows = await rowsAs(db, "anon", "select * from public.public_talent_media_view where talent_id = $1", [ids.publishedTalent]);
    assert.deepEqual(rows.map((row) => row.image_path), [`talent/${ids.publishedTalent}/approved.jpg`]);
    assert.ok("image_type" in rows[0], "the photo type is public so digitals get their own section (034)");
    for (const column of ["storage_path", "source_url", "content_sha256", "original_file_name"]) assert.ok(!(column in rows[0]), `${column} exposed`);
    assert.equal((await rowsAs(db, "anon", "select * from public.public_talents_view where slug = 'draft-test'")).length, 0);
  });

  test("cannot list talent storage buckets", async () => {
    assert.deepEqual(await rowsAs(db, "anon", "select name from storage.objects where bucket_id in ('talent-public', 'talent-private')"), []);
  });
});

describe("privilege escalation", () => {
  test("an outsider who impersonated the owner before the fix has no access", async () => {
    const [profile] = await superuser(`select email, role, status from public.profiles where id = '${ids.outsider}'`);
    assert.deepEqual(profile, { email: users.outsider.email, role: "read_only", status: "pending" });
    assert.equal((await as(db, users.outsider, "select public.has_role('owner') as ok")).rows[0].ok, false);
    assert.deepEqual(await rowsAs(db, users.outsider, "select * from public.talent_banking"), []);
    assert.deepEqual(await rowsAs(db, users.outsider, "select * from public.talent"), []);
  });

  test("an outsider cannot rewrite their profile email or role", async () => {
    await rowsAs(db, users.outsider, `update public.profiles set email = '${users.owner.email}', role = 'owner', status = 'active' where id = '${ids.outsider}'`);
    assert.equal((await as(db, users.outsider, "select public.has_any_role(array['owner','administrator']) as ok")).rows[0].ok, false);
    assert.deepEqual(await rowsAs(db, users.outsider, "select * from public.agency_members"), []);
  });

  test("a read-only member cannot promote themselves via profiles.role", async () => {
    await rowsAs(db, users.readOnly, `update public.profiles set role = 'administrator' where id = '${ids.readOnly}'`);
    assert.equal((await as(db, users.readOnly, "select public.has_any_role(array['administrator']) as ok")).rows[0].ok, false);
    assert.deepEqual(await rowsAs(db, users.readOnly, "select * from public.talent_banking"), []);
  });

  test("a read-only member cannot grant themselves profile_roles", async () => {
    assert.ok(await rejects(db, users.readOnly, `insert into public.profile_roles (profile_id, role_id) select '${ids.readOnly}', id from public.roles where key = 'owner'`));
  });

  test("a read-only member cannot edit their own membership", async () => {
    await rowsAs(db, users.readOnly, `update public.agency_members set role = 'owner' where lower(email) = '${users.readOnly.email}'`);
    assert.equal((await superuser(`select role from public.agency_members where lower(email) = '${users.readOnly.email}'`))[0].role, "read_only");
  });

  test("profiles can still update their own display name", async () => {
    await as(db, users.readOnly, `update public.profiles set full_name = 'Renamed' where id = '${ids.readOnly}'`);
    assert.equal((await superuser(`select full_name from public.profiles where id = '${ids.readOnly}'`))[0].full_name, "Renamed");
  });
});

describe("role-restricted modules", () => {
  test("owner keeps full access after the migration", async () => {
    assert.equal((await as(db, users.owner, "select public.has_role('owner') as ok")).rows[0].ok, true);
    assert.equal((await rowsAs(db, users.owner, "select * from public.talent_banking")).length, 1);
    assert.ok((await rowsAs(db, users.owner, "select * from public.agency_members")).length >= 6);
  });

  test("accounting can read banking; creative and talent manager cannot", async () => {
    assert.equal((await rowsAs(db, users.accounting, "select * from public.talent_banking")).length, 1);
    assert.deepEqual(await rowsAs(db, users.creative, "select * from public.talent_banking"), []);
    assert.deepEqual(await rowsAs(db, users.talentManager, "select * from public.talent_banking"), []);
  });

  test("creative cannot read medical records", async () => {
    assert.deepEqual(await rowsAs(db, users.creative, "select * from public.talent_medical"), []);
  });

  test("only owner/administrator can read audit logs", async () => {
    assert.ok((await rowsAs(db, users.owner, "select * from public.audit_log")).length >= 1);
    assert.deepEqual(await rowsAs(db, users.talentManager, "select * from public.audit_log"), []);
    assert.deepEqual(await rowsAs(db, users.readOnly, "select * from public.audit_logs"), []);
  });
});

describe("membership lifecycle", () => {
  test("owner cannot choose a member's user_id directly", async () => {
    assert.ok(await rejects(db, users.owner, `insert into public.agency_members (email, role, status, user_id) values ('x@example.test', 'booker', 'active', '${ids.outsider}')`));
  });

  test("owner approving an existing confirmed user binds and syncs their profile", async () => {
    await as(db, users.owner, `insert into public.agency_members (email, full_name, role, status) values ('${users.lateInvitee.email}', 'Late', 'booker', 'active')`);
    const [member] = await superuser(`select user_id from public.agency_members where email = '${users.lateInvitee.email}'`);
    assert.equal(member.user_id, ids.lateInvitee);
    assert.equal((await superuser(`select role, status from public.profiles where id = '${ids.lateInvitee}'`))[0].role, "booker");
    assert.equal((await as(db, users.lateInvitee, "select public.has_role('booker') as ok")).rows[0].ok, true);
  });

  test("an invited email is not bound until the Auth user confirms it", async () => {
    await superuser(`insert into auth.users (id, email) values ('${ids.unconfirmed}', '${users.unconfirmed.email}')`);
    assert.equal((await superuser(`select user_id from public.agency_members where email = '${users.unconfirmed.email}'`))[0].user_id, null);
    assert.equal((await as(db, users.unconfirmed, "select public.has_role('booker') as ok")).rows[0].ok, false);
    await superuser(`update auth.users set email_confirmed_at = now() where id = '${ids.unconfirmed}'`);
    assert.equal((await superuser(`select user_id from public.agency_members where email = '${users.unconfirmed.email}'`))[0].user_id, ids.unconfirmed);
    assert.equal((await as(db, users.unconfirmed, "select public.has_role('booker') as ok")).rows[0].ok, true);
  });

  test("suspending a member removes their access", async () => {
    await as(db, users.owner, `update public.agency_members set status = 'suspended' where email = '${users.lateInvitee.email}'`);
    assert.equal((await as(db, users.lateInvitee, "select public.is_active_agency_member() as ok")).rows[0].ok, false);
    assert.equal((await superuser(`select status from public.profiles where id = '${ids.lateInvitee}'`))[0].status, "suspended");
  });

  test("the last active owner cannot be demoted or removed", async () => {
    assert.ok(await rejects(db, users.owner, `update public.agency_members set role = 'administrator' where email = '${users.owner.email}'`));
    assert.ok(await rejects(db, users.owner, `delete from public.agency_members where email = '${users.owner.email}'`));
    assert.equal((await superuser(`select role, status from public.agency_members where email = '${users.owner.email}'`))[0].role, "owner");
  });

  test("the README owner-recovery SQL works for existing and not-yet-signed-in owners", async () => {
    const recovery = (email) => `insert into public.agency_members (email, full_name, role, status)
      values (lower('${email}'), 'Owner', 'owner', 'active')
      on conflict ((lower(email))) do update set role = 'owner', status = 'active', updated_at = now();`;
    await superuser(recovery(users.owner.email));
    await superuser(recovery("future-owner@example.test"));
    const rows = await superuser("select email, role, status from public.agency_members where email in ($1, 'future-owner@example.test') order by email", [users.owner.email]);
    assert.deepEqual(rows.map((row) => row.role + ":" + row.status), ["owner:active", "owner:active"]);
    assert.equal((await as(db, users.owner, "select public.has_role('owner') as ok")).rows[0].ok, true);
  });

  test("role changes are audited", async () => {
    const rows = await superuser("select action from public.audit_logs where entity_type = 'agency_members'");
    assert.ok(rows.some((row) => row.action === "agency_member.update"));
  });
});

describe("audit logging", () => {
  test("members write audit events as themselves only", async () => {
    await as(db, users.talentManager, "select public.write_audit('test.event', 'talent', $1::uuid, '{}'::jsonb)", [ids.draftTalent]);
    const [row] = await superuser("select actor_id from public.audit_logs where action = 'test.event'");
    assert.equal(row.actor_id, ids.talentManager);
  });

  test("non-members cannot write audit events and nobody can insert directly", async () => {
    assert.ok(await rejects(db, users.outsider, "select public.write_audit('forged', 'talent')"));
    assert.ok(await rejects(db, users.owner, "insert into public.audit_logs (action, entity_type) values ('forged', 'x')"));
  });

  test("publishing is audited by the database", async () => {
    await as(db, users.talentManager, `update public.talent set publication_status = 'published', show_on_website = true where id = '${ids.draftTalent}'`);
    const rows = await superuser(`select action, actor_id from public.audit_logs where entity_id = '${ids.draftTalent}' and action = 'talent.published'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_id, ids.talentManager);
  });
});

describe("media storage", () => {
  test("media staff can upload to the private bucket; read-only cannot", async () => {
    await as(db, users.creative, "insert into storage.objects (bucket_id, name) values ('talent-private', 'talent/x/new.jpg')");
    assert.ok(await rejects(db, users.readOnly, "insert into storage.objects (bucket_id, name) values ('talent-private', 'talent/x/evil.jpg')"));
  });

  test("new photo records default to the private bucket", async () => {
    const [row] = await superuser(`insert into public.talent_photos (talent_id, storage_path) values ('${ids.draftTalent}', 'talent/x/new.jpg') returning storage_bucket, "public"`);
    assert.deepEqual(row, { storage_bucket: "talent-private", public: false });
  });

  test("buckets enforce size and type limits", async () => {
    const rows = await superuser("select id from storage.buckets where file_size_limit is null or allowed_mime_types is null");
    assert.deepEqual(rows, []);
  });
});
