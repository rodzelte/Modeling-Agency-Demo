// Phase 19: team profile photos (migration 027).
// Run: node --test tests/rls/team-profile.test.mjs
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addMember, as, createDatabase, newUser, rejects, rowsAs, users } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;
const upload = (user, name) => as(db, user, "insert into storage.objects (bucket_id, name, owner) values ('team-avatars', $1, auth.uid())", [name]);

before(async () => {
  db = await createDatabase();
});

describe("phase 19: team profile photos", () => {
  test("the bucket is public, small and image-only", async () => {
    const [bucket] = await su("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'team-avatars'");
    assert.equal(bucket.public, true);
    assert.equal(Number(bucket.file_size_limit), 5242880);
    assert.deepEqual(bucket.allowed_mime_types, ["image/jpeg", "image/png", "image/webp"]);
  });

  test("a member uploads, sees and deletes only inside their own folder", async () => {
    await upload(users.creative, `${users.creative.id}/photo.jpg`);
    assert.equal((await rowsAs(db, users.creative, "select name from storage.objects where bucket_id = 'team-avatars'")).length, 1);
    assert.deepEqual(await rowsAs(db, users.readOnly, "select name from storage.objects where bucket_id = 'team-avatars'"), []);
    assert.ok(await rejects(db, users.creative, "insert into storage.objects (bucket_id, name) values ('team-avatars', $1)", [`${users.readOnly.id}/photo.jpg`]));

    await as(db, users.readOnly, "delete from storage.objects where bucket_id = 'team-avatars'");
    assert.equal((await su("select count(*)::int as n from storage.objects where bucket_id = 'team-avatars'"))[0].n, 1, "others cannot delete it");
    await as(db, users.creative, "delete from storage.objects where bucket_id = 'team-avatars'");
    assert.equal((await su("select count(*)::int as n from storage.objects where bucket_id = 'team-avatars'"))[0].n, 0);
  });

  test("people without an active membership cannot upload", async () => {
    assert.ok(await rejects(db, users.outsider, "insert into storage.objects (bucket_id, name) values ('team-avatars', $1)", [`${users.outsider.id}/photo.jpg`]));
    assert.ok(await rejects(db, "anon", "insert into storage.objects (bucket_id, name) values ('team-avatars', 'x/photo.jpg')"));
  });
});

describe("phase 19: removing a teammate", () => {
  test("the owner removes a member; their profile is suspended and the removal audited", async () => {
    const member = await addMember(db, newUser("leaver"), "booker");
    await as(db, users.owner, "delete from public.agency_members where lower(email) = $1", [member.email]);
    assert.deepEqual(await su("select id from public.agency_members where lower(email) = $1", [member.email]), []);
    const [profile] = await su("select status from public.profiles where id = $1", [member.id]);
    assert.equal(profile.status, "suspended");
    assert.equal((await su("select count(*)::int as n from public.audit_logs where action = 'agency_member.delete' and before_data->>'email' = $1", [member.email]))[0].n, 1);
  });

  test("only team managers can remove members, and never the owner", async () => {
    const member = await addMember(db, newUser("stayer"), "booker");
    await as(db, users.talentManager, "delete from public.agency_members where lower(email) = $1", [member.email]);
    assert.equal((await su("select count(*)::int as n from public.agency_members where lower(email) = $1", [member.email]))[0].n, 1);
    assert.ok(await rejects(db, users.owner, "delete from public.agency_members where email = $1", [users.owner.email]));
  });
});
