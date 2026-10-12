// Phase 10: the public search filters only on public-view columns, which are NULL
// when a talent hides them, so filtering can never reveal a hidden value.
// Run: npm run test:rls
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, rowsAs } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;

before(async () => {
  db = await createDatabase();
  const board = (await su("select id from public.boards where slug = 'teens-boys'"))[0].id;
  const make = async (slug, showMeasurements, showAge) => {
    const [{ id }] = await su(
      "insert into public.talent (slug, first_name, last_name, display_name, publication_status, show_on_website, show_measurements, show_age) values ($1, 'F', 'L', $1, 'published', true, $2, $3) returning id",
      [slug, showMeasurements, showAge]);
    await su("insert into public.talent_private_details (talent_id, date_of_birth) values ($1, '2000-01-15') on conflict (talent_id) do update set date_of_birth = excluded.date_of_birth", [id]);
    await su("insert into public.talent_measurements (talent_id, height_cm, waist_cm, hair_color) values ($1, 180, 70, 'Red')", [id]);
    await su("insert into public.talent_board_assignments (talent_id, board_id) values ($1, $2)", [id, board]);
    return id;
  };
  await make("shows-all", true, true);
  await make("hides-all", false, false);
});

describe("phase 10: public search cannot reveal hidden values", () => {
  test("measurement filters match only talent who show measurements", async () => {
    const rows = await rowsAs(db, "anon", "select slug from public.public_talents_view where height_cm between 175 and 185 and waist_cm <= 71 order by slug");
    assert.deepEqual(rows.map((row) => row.slug), ["shows-all"]);
  });

  test("hair filter ignores hidden measurements", async () => {
    const rows = await rowsAs(db, "anon", "select slug from public.public_talents_view where hair_color ilike 'red'");
    assert.deepEqual(rows.map((row) => row.slug), ["shows-all"]);
  });

  test("age filters match only talent who show their age", async () => {
    const rows = await rowsAs(db, "anon", "select slug from public.public_talents_view where age between 18 and 40 and slug in ('shows-all', 'hides-all')");
    assert.deepEqual(rows.map((row) => row.slug), ["shows-all"]);
  });

  test("board overlap filter works on board_paths", async () => {
    const rows = await rowsAs(db, "anon", "select slug from public.public_talents_view where board_paths && array(select path from public.public_boards_view where path like 'teens%') and slug in ('shows-all', 'hides-all') order by slug");
    assert.deepEqual(rows.map((row) => row.slug), ["hides-all", "shows-all"]);
  });
});
