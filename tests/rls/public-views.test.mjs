// Public views: no SECURITY DEFINER views (Supabase advisor lint 0010), and anonymous
// visitors see only published, public-safe data through RLS. Checked at the
// production-equivalent state (migrations up to 010) and with every migration.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { as, createDatabase, ids, rejects, rowsAs } from "./harness.mjs";

const invokerCheck = `
  select c.relname, coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false) as invoker
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'`;

for (const [label, upto, views, profileView] of [
  ["through 010 (production hotfix)", 10, "public_talent_directory", "public_talent_profiles"],
  ["all migrations", undefined, "public_talents_view", "public_talents_view"],
]) {
  describe(`public views ${label}`, () => {
    let db;
    before(async () => {
      db = await createDatabase({ upto });
    });

    test("every public view runs with the caller's rights", async () => {
      const rows = (await db.query(invokerCheck)).rows;
      assert.ok(rows.length > 0);
      assert.deepEqual(rows.filter((row) => !row.invoker).map((row) => row.relname), []);
    });

    test("anonymous visitors see published talent only", async () => {
      const rows = await rowsAs(db, "anon", `select slug from public.${views}`);
      assert.deepEqual([...new Set(rows.map((row) => row.slug))], ["saih-test"]);
    });

    test("private talent columns are not readable by anonymous visitors", async () => {
      for (const column of ["date_of_birth", "mobile", "email", "first_name", "last_name", "minimum_day_rate"]) {
        assert.ok(await rejects(db, "anon", `select ${column} from public.talent`), `${column} readable`);
      }
      const rows = await rowsAs(db, "anon", "select id from public.talent");
      assert.deepEqual(rows.map((row) => row.id), [ids.publishedTalent]);
    });

    test("anonymous visitors cannot read private photos, banking, or private details", async () => {
      const photos = await rowsAs(db, "anon", "select public_storage_path from public.talent_photos");
      assert.deepEqual(photos.map((row) => row.public_storage_path), [`talent/${ids.publishedTalent}/approved.jpg`]);
      assert.deepEqual(await rowsAs(db, "anon", "select * from public.talent_banking"), []);
      assert.deepEqual(await rowsAs(db, "anon", "select * from public.talent_private_details"), []);
    });

    test("age is exposed only when show_age is on, never the DOB", async () => {
      let [row] = await rowsAs(db, "anon", `select age from public.${profileView} where slug = 'saih-test'`);
      assert.equal(row.age, null);
      await db.query("update public.talent set show_age = true where id = $1", [ids.publishedTalent]);
      [row] = await rowsAs(db, "anon", `select age from public.${profileView} where slug = 'saih-test'`);
      const expected = new Date().getFullYear() - 2011 - (new Date() < new Date(new Date().getFullYear(), 3, 2) ? 1 : 0);
      assert.equal(row.age, expected);
      await db.query("update public.talent set show_age = false where id = $1", [ids.publishedTalent]);
    });

    test("unpublishing removes the talent from public views immediately", async () => {
      await db.query("update public.talent set show_on_website = false where id = $1", [ids.publishedTalent]);
      assert.deepEqual(await rowsAs(db, "anon", `select slug from public.${views}`), []);
      await db.query("update public.talent set show_on_website = true where id = $1", [ids.publishedTalent]);
    });
  });
}

describe("public visibility flags (all migrations)", () => {
  let db;
  before(async () => {
    db = await createDatabase();
    await db.query("insert into public.talent_measurements (talent_id, measured_on, height_cm, is_official) values ($1, '2026-01-01', 180, true)", [ids.publishedTalent]);
  });

  test("hidden measurements are absent from the view and the table", async () => {
    let [row] = await rowsAs(db, "anon", "select height_cm from public.public_talents_view where id = $1", [ids.publishedTalent]);
    assert.equal(Number(row.height_cm), 180);
    await db.query("update public.talent set show_measurements = false where id = $1", [ids.publishedTalent]);
    [row] = await rowsAs(db, "anon", "select height_cm from public.public_talents_view where id = $1", [ids.publishedTalent]);
    assert.equal(row.height_cm, null);
    assert.deepEqual(await rowsAs(db, "anon", "select height_cm from public.talent_measurements"), []);
  });

  test("signed-in staff still read through their own permissions", async () => {
    const rows = (await as(db, { id: ids.owner, email: "owner@example.test" }, "select count(*)::int as n from public.talent")).rows;
    assert.ok(rows[0].n >= 2);
  });
});
