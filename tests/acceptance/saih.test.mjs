// Release-blocking acceptance workflow from the spec (§51), executed through RLS as
// the real roles: a talent manager and a creative in the dashboard, and an anonymous
// visitor on the website (public views). Storage copies are represented by the
// photo rows the dashboard API writes (public_storage_path after promotion).
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { as, createDatabase, users } from "../rls/harness.mjs";

let db;
let saih;
let photos;
const manager = users.talentManager;
const creative = users.creative;
const anonRows = async (sql, params = []) => (await as(db, "anon", sql, params)).rows;
const boardId = async (slug) => (await db.query("select id from public.boards where slug = $1", [slug])).rows[0].id;
const onBoard = async (path) => (await anonRows("select slug from public.public_talents_view where board_paths @> array[$1]::text[]", [path])).map((row) => row.slug);
const publicGallery = async () => (await anonRows("select title from public.public_talent_media_view where talent_id = $1 and media_type = 'image' order by display_order", [saih])).map((row) => row.title);

before(async () => {
  db = await createDatabase();
});

test("1–4. a talent manager creates Saih (Male, Dallas) as a private draft", async () => {
  saih = (await as(db, manager, `insert into public.talent (slug, talent_id, first_name, last_name, display_name, gender, location)
    values ('saih-acc01', 'T-ACC01', 'Saih', '', 'Saih', 'Male', 'Dallas') returning id`)).rows[0].id;
  await as(db, manager, "insert into public.talent_private_details (talent_id, date_of_birth) values ($1, '2011-05-01')", [saih]);
  const [row] = (await db.query("select publication_status, show_on_website, created_by from public.talent where id = $1", [saih])).rows;
  assert.deepEqual({ ...row, created_by: row.created_by === manager.id }, { publication_status: "draft", show_on_website: false, created_by: true });
  assert.deepEqual(await anonRows("select slug from public.public_talents_view where id = $1", [saih]), []);
});

test("5–6. a creative uploads three photos privately and picks the primary image", async () => {
  photos = [];
  for (const name of ["one", "two", "three"]) {
    photos.push((await as(db, creative, `insert into public.talent_photos (talent_id, storage_path, title, storage_bucket, display_order)
      values ($1, $2, $3, 'talent-private', $4) returning id`, [saih, `talent/${saih}/${name}.jpg`, name, photos.length])).rows[0].id);
  }
  // "Make public" copies each original to talent-public and records the public path.
  for (const [index, id] of photos.entries()) {
    await as(db, creative, "update public.talent_photos set public = true, public_storage_path = $2 where id = $1", [id, `talent/${saih}/${id}-${index}.jpg`]);
  }
  await as(db, creative, "select public.set_featured_photo($1, $2)", [saih, photos[1]]);
  const featured = (await db.query("select id from public.talent_photos where talent_id = $1 and featured", [saih])).rows.map((row) => row.id);
  assert.deepEqual(featured, [photos[1]]);
});

test("7. measurements are recorded as an official snapshot", async () => {
  await as(db, manager, `insert into public.talent_measurements (talent_id, measured_on, is_official, height_cm, bust_chest_cm, waist_cm, eye_color, hair_color, shoe_size_us)
    values ($1, '2026-09-01', true, 170, 81, 66, 'Brown', 'Black', '9')`, [saih]);
});

test("8. Saih is assigned to Teens → Boys", async () => {
  await as(db, manager, "insert into public.talent_board_assignments (talent_id, board_id) values ($1, $2)", [saih, await boardId("teens-boys")]);
  assert.equal((await db.query("select public.board_path($1) as path", [await boardId("teens-boys")])).rows[0].path, "teens/boys");
});

test("9. images are reordered", async () => {
  await as(db, creative, "select public.reorder_talent_photos($1, $2::uuid[])", [saih, [photos[2], photos[0], photos[1]]]);
});

test("10–11. show on website and publish (still private until both are set)", async () => {
  assert.deepEqual(await onBoard("teens/boys"), ["saih-test"]);
  await as(db, manager, "update public.talent set show_on_website = true where id = $1", [saih]);
  assert.ok(!(await onBoard("teens/boys")).includes("saih-acc01"), "visible before publishing");
  await as(db, manager, "update public.talent set publication_status = 'published' where id = $1", [saih]);
});

test("12–13. Saih appears automatically on the public Teens/Boys board", async () => {
  assert.ok((await onBoard("teens/boys")).includes("saih-acc01"));
  const boards = (await anonRows("select path from public.public_boards_view")).map((row) => row.path);
  assert.ok(boards.includes("teens/boys"));
});

test("14–15. the public profile shows approved information and images only", async () => {
  const [profile] = await anonRows("select * from public.public_talents_view where slug = 'saih-acc01'");
  assert.equal(profile.display_name, "Saih");
  assert.equal(profile.location, "Dallas");
  assert.equal(Number(profile.height_cm), 170);
  assert.equal(profile.eye_color, "Brown");
  assert.equal(profile.age, null, "age is opt-in");
  for (const column of ["date_of_birth", "first_name", "last_name", "mobile", "email", "notes"]) assert.ok(!(column in profile), `${column} exposed`);
  assert.equal(profile.primary_image_path.includes(photos[1]), true, "primary image is the chosen one");
  assert.deepEqual(await publicGallery(), ["three", "one", "two"]);
});

test("16–17. reordering in the dashboard updates the website order", async () => {
  await as(db, creative, "select public.reorder_talent_photos($1, $2::uuid[])", [saih, [photos[0], photos[1], photos[2]]]);
  assert.deepEqual(await publicGallery(), ["one", "two", "three"]);
});

test("18–20. removing Teens → Boys hides Saih from that board but keeps the record", async () => {
  await as(db, manager, "delete from public.talent_board_assignments where talent_id = $1 and board_id = $2", [saih, await boardId("teens-boys")]);
  assert.ok(!(await onBoard("teens/boys")).includes("saih-acc01"));
  const [row] = (await db.query("select count(*)::int as n from public.talent where id = $1", [saih])).rows;
  assert.equal(row.n, 1);
  assert.equal((await db.query("select count(*)::int as n from public.talent_photos where talent_id = $1", [saih])).rows[0].n, 3);
});

test("21–22. reassigning the board brings Saih back", async () => {
  await as(db, manager, "insert into public.talent_board_assignments (talent_id, board_id) values ($1, $2)", [saih, await boardId("teens-boys")]);
  assert.ok((await onBoard("teens/boys")).includes("saih-acc01"));
});

test("23–25. unpublishing removes the public profile; internal data is untouched", async () => {
  await as(db, manager, "update public.talent set publication_status = 'draft', show_on_website = false where id = $1", [saih]);
  assert.deepEqual(await anonRows("select slug from public.public_talents_view where id = $1", [saih]), []);
  assert.deepEqual(await anonRows("select id from public.public_talent_media_view where talent_id = $1", [saih]), []);
  assert.deepEqual(await anonRows("select id from public.talent_photos where talent_id = $1", [saih]), []);
  const internal = (await db.query(`select (select count(*) from public.talent_photos where talent_id = $1)::int as photos,
    (select count(*) from public.talent_measurements where talent_id = $1)::int as measurements,
    (select count(*) from public.talent_board_assignments where talent_id = $1)::int as boards,
    (select date_of_birth::text from public.talent_private_details where talent_id = $1) as dob`, [saih])).rows[0];
  assert.deepEqual(internal, { photos: 3, measurements: 1, boards: 1, dob: "2011-05-01" });
  const actions = (await db.query("select action from public.audit_logs where entity_id = $1 order by created_at", [saih])).rows.map((row) => row.action);
  for (const action of ["board.assigned", "talent.published", "board.removed", "talent.unpublished"]) assert.ok(actions.includes(action), `missing audit ${action}`);
});
