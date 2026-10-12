// Phase 9 (release foundation): the talent contract step and sign-in auditing.
// Run: npm run test:rls
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDatabase, ids, rejects, rowsAs, users } from "./harness.mjs";

const migration019 = readFileSync(join(import.meta.dirname, "..", "..", "supabase", "migrations", "019_release_foundation.sql"), "utf8");
const privateColumns = ["date_of_birth", "mobile", "email", "allow_sms", "minimum_day_rate"];

describe("phase 9: talent contract step", () => {
  let db;
  before(async () => {
    // Stop before 019 to simulate values that 012 did not carry over, then apply it.
    db = await createDatabase({ upto: 18 });
    await db.query("update public.talent set mobile = '555-0199', allow_sms = true where id = $1", [ids.draftTalent]);
    await db.query("update public.talent_private_details set mobile = null, allow_sms = false where talent_id = $1", [ids.draftTalent]);
    await db.exec(migration019);
  });

  test("private columns no longer exist on talent", async () => {
    const { rows } = await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'talent' and column_name = any($1)", [privateColumns]);
    assert.deepEqual(rows, []);
  });

  test("values missing from private details are merged before dropping", async () => {
    const { rows: [row] } = await db.query("select mobile, allow_sms from public.talent_private_details where talent_id = $1", [ids.draftTalent]);
    assert.equal(row.mobile, "555-0199");
    assert.equal(row.allow_sms, true);
  });

  test("the dropped columns are backed up outside the API", async () => {
    const { rows: [row] } = await db.query("select date_of_birth::text as dob, mobile from archive.talent_private_columns_019 where talent_id = $1", [ids.publishedTalent]);
    assert.equal(row.dob, "2011-04-02");
    assert.ok(await rejects(db, users.owner, "select * from archive.talent_private_columns_019"));
    assert.ok(await rejects(db, "anon", "select * from archive.talent_private_columns_019"));
  });

  test("the migration is idempotent", async () => {
    await db.exec(migration019);
    const { rows } = await db.query("select count(*)::int as n from archive.talent_private_columns_019");
    assert.equal(rows[0].n, 2);
  });

  test("public age still works from private details", async () => {
    const { rows } = await db.query("select age from public.public_talents_view where id = $1", [ids.publishedTalent]);
    assert.equal(rows.length, 1);
  });
});

describe("phase 9: sign-in audit", () => {
  let db;
  before(async () => {
    db = await createDatabase();
  });

  test("a member sign-in writes auth.login with the member as actor", async () => {
    await db.query("update auth.users set last_sign_in_at = now() where id = $1", [ids.owner]);
    const { rows } = await db.query("select actor_id, metadata from public.audit_logs where action = 'auth.login' and entity_id = $1", [ids.owner]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_id, ids.owner);
    assert.equal(rows[0].metadata.role, "owner");
  });

  test("an unapproved sign-in is recorded without actor or email", async () => {
    await db.query("update auth.users set last_sign_in_at = now() where id = $1", [ids.outsider]);
    const { rows } = await db.query("select actor_id, metadata from public.audit_logs where action = 'auth.login_unapproved' and entity_id = $1", [ids.outsider]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_id, null);
    assert.deepEqual(rows[0].metadata, {});
  });

  test("other auth.users updates are not logged as sign-ins", async () => {
    await db.query("update auth.users set raw_user_meta_data = '{\"x\":1}' where id = $1", [ids.readOnly]);
    const { rows } = await db.query("select 1 from public.audit_logs where action like 'auth.%' and entity_id = $1", [ids.readOnly]);
    assert.equal(rows.length, 0);
  });

  test("signed-in users cannot call the audit trigger function", async () => {
    assert.ok(await rejects(db, users.owner, "select public.audit_sign_in()"));
    assert.deepEqual(await rowsAs(db, users.readOnly, "select * from public.audit_logs"), []);
  });
});
