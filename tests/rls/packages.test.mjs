// Phase 14: packages shared with clients by hashed, expiring, revocable links.
// Run: npm run test:rls
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { addMember, as, createDatabase, ids, newUser, rejects, rowsAs, users } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;
const hash = (token) => createHash("sha256").update(token).digest("hex");
const people = {};
let packageId;
let draftId;
const TOKEN = "test-token-abcdefghijklmnopqrstuvwxyz0123456789";

before(async () => {
  db = await createDatabase();
  people.booker = await addMember(db, newUser("booker"), "booker");
  // A draft (unpublished) talent with a secret, an unapproved photo and an approved one.
  draftId = (await su("insert into public.talent (slug, first_name, last_name, display_name, location, show_measurements) values ('pkg-draft', 'Dana', 'Secret', 'Dana', 'Dallas', true) returning id"))[0].id;
  await su("insert into public.talent_private_details (talent_id, date_of_birth, mobile) values ($1, '2001-02-03', '555-9999')", [draftId]);
  await su("insert into public.talent_measurements (talent_id, height_cm, waist_cm) values ($1, 175, 64)", [draftId]);
  await su(`insert into public.talent_photos (talent_id, storage_path, storage_bucket, "public", public_storage_path) values
    ($1, 'talent/x/private.jpg', 'talent-private', false, null), ($1, 'talent/x/approved.jpg', 'talent-private', true, 'talent/x/approved-public.jpg')`, [draftId]);
  packageId = (await as(db, people.booker, "insert into public.packages (title, message) values ('Swim casting', 'Our picks') returning id")).rows[0].id;
  await as(db, people.booker, `insert into public.package_items (package_id, talent_id, sort_order) values ('${packageId}', '${draftId}', 1), ('${packageId}', '${ids.publishedTalent}', 2)`);
});

describe("phase 14: package access", () => {
  test("only package managers can see or edit packages", async () => {
    assert.deepEqual(await rowsAs(db, users.creative, "select id from public.packages"), []);
    assert.deepEqual(await rowsAs(db, "anon", "select id from public.packages"), []);
    assert.ok(await rejects(db, users.readOnly, "insert into public.packages (title) values ('x')"));
  });

  test("an unshared package returns nothing for any token", async () => {
    const { rows: [row] } = await as(db, "anon", `select public.get_shared_package('${hash(TOKEN)}') as data`);
    assert.equal(row.data, null);
  });

  test("a shared link shows only public-safe fields and approved photos", async () => {
    await as(db, people.booker, `update public.packages set share_token_hash = '${hash(TOKEN)}', shared_at = now(), expires_at = now() + interval '30 days' where id = '${packageId}'`);
    const { rows: [{ data }] } = await as(db, "anon", `select public.get_shared_package('${hash(TOKEN)}') as data`);
    assert.equal(data.title, "Swim casting");
    assert.equal(data.talent.length, 2);
    const dana = data.talent.find((item) => item.name === "Dana");
    assert.deepEqual(dana.photos.map((photo) => photo.path), ["talent/x/approved-public.jpg"]);
    assert.equal(dana.measurements.height_cm, 175);
    assert.equal(dana.profile_slug, null, "unpublished talent get no profile link");
    const text = JSON.stringify(data);
    for (const secret of ["2001-02-03", "555-9999", "Secret", "private.jpg"]) assert.ok(!text.includes(secret), `${secret} leaked`);
    assert.equal((await su("select view_count from public.packages where id = $1", [packageId]))[0].view_count, 1);
    assert.equal((await su("select 1 from public.audit_logs where action = 'package.shared' and entity_id = $1", [packageId])).length, 1);
  });

  test("hidden measurements stay hidden", async () => {
    await su("update public.talent set show_measurements = false where id = $1", [draftId]);
    const { rows: [{ data }] } = await as(db, "anon", `select public.get_shared_package('${hash(TOKEN)}') as data`);
    assert.equal(data.talent.find((item) => item.name === "Dana").measurements, null);
  });

  test("wrong, malformed, expired and revoked tokens return nothing", async () => {
    for (const bad of [hash("other"), "not-a-hash", "' or 1=1 --"]) {
      const { rows: [row] } = await as(db, "anon", "select public.get_shared_package($1) as data", [bad]);
      assert.equal(row.data, null, bad);
    }
    await su("update public.packages set expires_at = now() - interval '1 minute' where id = $1", [packageId]);
    assert.equal((await as(db, "anon", `select public.get_shared_package('${hash(TOKEN)}') as data`)).rows[0].data, null);
    await su("update public.packages set expires_at = now() + interval '1 day', revoked_at = now() where id = $1", [packageId]);
    assert.equal((await as(db, "anon", `select public.get_shared_package('${hash(TOKEN)}') as data`)).rows[0].data, null);
  });

  test("anonymous callers cannot read the token hash or change counters directly", async () => {
    assert.ok(await rejects(db, "anon", "select share_token_hash from public.packages"));
    assert.ok(await rejects(db, "anon", "update public.packages set view_count = 0"));
  });
});
