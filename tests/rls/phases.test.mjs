// Phase 1–7 database behaviour: permissions, talent core, boards, profile modules,
// media, and sensitive modules. Run: npm run test:rls
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addMember, as, createDatabase, ids, newUser, rejects, rowsAs, users } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await su(sql, params))[0];
const people = {};
let talentA;
let talentB;

before(async () => {
  db = await createDatabase();
  talentA = (await one("insert into public.talent (slug, first_name, last_name, display_name) values ('talent-a', 'Alex', 'A', 'Alex') returning id")).id;
  talentB = (await one("insert into public.talent (slug, first_name, last_name, display_name) values ('talent-b', 'Blake', 'B', 'Blake') returning id")).id;
  await su("insert into public.talent_private_details (talent_id, mobile) values ($1, '555-0101'), ($2, '555-0102')", [talentA, talentB]);
  people.admin = await addMember(db, newUser("admin"), "administrator");
  people.booker = await addMember(db, newUser("booker"), "booker");
  people.talentUserA = await addMember(db, newUser("talent-a"), "talent", talentA);
  people.talentUserB = await addMember(db, newUser("talent-b"), "talent", talentB);
});

describe("phase 1: permissions", () => {
  test("roles resolve to the permission matrix", async () => {
    const perms = async (user) => (await as(db, user, "select public.current_permissions() as p")).rows[0].p;
    const creative = await perms(users.creative);
    assert.ok(creative.includes("media.manage"));
    assert.ok(!creative.includes("banking.view"));
    assert.ok((await perms(users.accounting)).includes("banking.view"));
    assert.ok(!(await perms(people.admin)).includes("team.manage"));
    assert.ok((await perms(users.owner)).includes("team.manage"));
    assert.deepEqual(await perms(people.talentUserA), []);
  });

  test("anonymous callers cannot evaluate permissions or read the matrix", async () => {
    assert.ok(await rejects(db, "anon", "select public.has_permission('talent.view')"));
    assert.deepEqual(await rowsAs(db, "anon", "select * from public.role_permissions"), []);
  });

  test("only team managers can change the matrix", async () => {
    await rowsAs(db, people.admin, "insert into public.role_permissions (role_key, permission_key) values ('creative', 'banking.view')");
    assert.equal((await su("select 1 from public.role_permissions where role_key = 'creative' and permission_key = 'banking.view'")).length, 0);
  });
});

describe("phase 3: talent core", () => {
  test("private columns are withdrawn from the API for every role", async () => {
    for (const column of ["date_of_birth", "mobile", "email", "minimum_day_rate"]) {
      assert.ok(await rejects(db, users.owner, `select ${column} from public.talent`), `${column} readable`);
    }
  });

  test("private details were copied and follow private permissions", async () => {
    const row = await one("select date_of_birth::text as dob from public.talent_private_details where talent_id = $1", [ids.publishedTalent]);
    assert.equal(row.dob, "2011-04-02");
    assert.deepEqual(await rowsAs(db, users.creative, "select * from public.talent_private_details"), []);
    assert.ok((await rowsAs(db, people.booker, "select * from public.talent_private_details")).length >= 2);
  });

  test("a booker can edit details but cannot publish", async () => {
    await as(db, people.booker, "update public.talent set display_name = 'Draft Renamed' where id = $1", [ids.draftTalent]);
    assert.equal((await one("select display_name from public.talent where id = $1", [ids.draftTalent])).display_name, "Draft Renamed");
    assert.ok(await rejects(db, people.booker, "update public.talent set publication_status = 'published', show_on_website = true where id = $1", [talentA]));
    assert.ok(await rejects(db, people.booker, "insert into public.talent (slug, first_name, last_name, display_name, publication_status, show_on_website) values ('sneaky', 'S', 'S', 'S', 'published', true)"));
    await as(db, people.booker, "insert into public.talent (slug, first_name, last_name, display_name) values ('booker-draft', 'B', 'D', 'Booker Draft')");
  });

  test("creative and read-only cannot edit talent", async () => {
    await rowsAs(db, users.creative, "update public.talent set display_name = 'Hacked' where id = $1", [talentA]);
    await rowsAs(db, users.readOnly, "update public.talent set display_name = 'Hacked' where id = $1", [talentA]);
    assert.equal((await one("select display_name from public.talent where id = $1", [talentA])).display_name, "Alex");
  });

  test("archive and restore keep the record and clear website visibility", async () => {
    await as(db, users.talentManager, "update public.talent set publication_status = 'published', show_on_website = true where id = $1", [talentB]);
    await as(db, users.talentManager, "update public.talent set publication_status = 'archived' where id = $1", [talentB]);
    let row = await one("select publication_status, show_on_website, archived_at from public.talent where id = $1", [talentB]);
    assert.equal(row.show_on_website, false);
    assert.ok(row.archived_at);
    assert.ok(await rejects(db, people.booker, "update public.talent set publication_status = 'draft' where id = $1", [talentB]));
    await as(db, users.talentManager, "update public.talent set publication_status = 'draft' where id = $1", [talentB]);
    row = await one("select publication_status, archived_at from public.talent where id = $1", [talentB]);
    assert.deepEqual(row, { publication_status: "draft", archived_at: null });
    const actions = (await su("select action from public.audit_logs where entity_id = $1 order by created_at", [talentB])).map((r) => r.action);
    assert.ok(actions.includes("talent.published") && actions.includes("talent.archived"));
  });

  test("talent users see only their own record", async () => {
    const own = await rowsAs(db, people.talentUserA, "select id from public.talent");
    assert.deepEqual(own.map((r) => r.id), [talentA]);
    // Since 024 the portal reads private details only through portal_profile() (allow-listed fields).
    assert.deepEqual(await rowsAs(db, people.talentUserA, "select talent_id from public.talent_private_details"), []);
    assert.equal((await rowsAs(db, people.talentUserA, "select public.portal_profile() as p"))[0].p.contact.mobile, "555-0101");
    assert.deepEqual(await rowsAs(db, people.talentUserA, "select * from public.talent_private_details where talent_id = $1", [talentB]), []);
    assert.deepEqual(await rowsAs(db, people.talentUserA, "select * from public.talent_banking"), []);
    assert.deepEqual(await rowsAs(db, people.talentUserA, "select * from public.talent_notes"), []);
    await rowsAs(db, people.talentUserA, "update public.talent set display_name = 'Mine' where id = $1", [talentA]);
    assert.equal((await one("select display_name from public.talent where id = $1", [talentA])).display_name, "Alex");
  });
});

describe("phase 4: boards", () => {
  test("legacy boards are arranged under category parents", async () => {
    const row = await one("select public.board_path(id) as path from public.boards where slug = 'teens-boys'");
    assert.equal(row.path, "teens/boys");
  });

  test("board managers create nested boards; others cannot", async () => {
    await as(db, users.talentManager, "insert into public.boards (name, slug, path_segment, parent_board_id) select 'Teens / Girls', 'teens-girls', 'girls', id from public.boards where slug = 'teens'");
    assert.equal((await one("select public.board_path(id) as path from public.boards where slug = 'teens-girls'")).path, "teens/girls");
    assert.ok(await rejects(db, users.creative, "insert into public.boards (name, slug) values ('Nope', 'nope')"));
  });

  test("cycles and duplicate sibling segments are rejected", async () => {
    assert.ok(await rejects(db, users.talentManager, "update public.boards set parent_board_id = (select id from public.boards where slug = 'teens-boys') where slug = 'teens'"));
    assert.ok(await rejects(db, users.talentManager, "insert into public.boards (name, slug, path_segment, parent_board_id) select 'Dup', 'dup-boys', 'boys', id from public.boards where slug = 'teens'"));
  });

  test("multi-board assignment, removal keeps talent, deactivation hides board only", async () => {
    await as(db, people.booker, "insert into public.talent_board_assignments (talent_id, board_id) select $1, id from public.boards where slug = 'teens-girls'", [ids.publishedTalent]);
    let row = await (await as(db, "anon", "select board_paths from public.public_talents_view where id = $1", [ids.publishedTalent])).rows[0];
    assert.deepEqual(row.board_paths, ["teens/boys", "teens/girls"]);

    await as(db, people.booker, "delete from public.talent_board_assignments where talent_id = $1 and board_id = (select id from public.boards where slug = 'teens-girls')", [ids.publishedTalent]);
    assert.equal((await su("select 1 from public.talent where id = $1", [ids.publishedTalent])).length, 1);

    await as(db, users.talentManager, "update public.boards set is_active = false where slug = 'teens'");
    row = (await as(db, "anon", "select board_paths from public.public_talents_view where id = $1", [ids.publishedTalent])).rows[0];
    assert.deepEqual(row.board_paths, []);
    assert.equal((await su("select 1 from public.talent_board_assignments where talent_id = $1", [ids.publishedTalent])).length, 1);
    await as(db, users.talentManager, "update public.boards set is_active = true where slug = 'teens'");
  });

  test("reordering follows array order and requires boards.manage", async () => {
    const [a, b] = (await su("select id from public.boards where slug in ('teens-boys', 'teens-girls') order by slug")).map((r) => r.id);
    await as(db, users.creative, "select public.reorder_boards($1::uuid[])", [[b, a]]);
    await as(db, users.talentManager, "select public.reorder_boards($1::uuid[])", [[b, a]]);
    const order = (await su("select slug from public.boards where id in ($1, $2) order by sort_order", [a, b])).map((r) => r.slug);
    assert.deepEqual(order, ["teens-girls", "teens-boys"]);
    assert.ok((await su("select 1 from public.audit_logs where action = 'board.assigned'")).length > 0);
  });
});

describe("phase 5: profile modules", () => {
  test("measurement history cannot be overwritten", async () => {
    await as(db, people.booker, "insert into public.talent_measurements (talent_id, measured_on, height_cm, is_official) values ($1, '2026-01-01', 170, true)", [talentA]);
    await as(db, people.booker, "insert into public.talent_measurements (talent_id, measured_on, height_cm, is_official) values ($1, '2026-06-01', 172, true)", [talentA]);
    assert.ok(await rejects(db, users.owner, "update public.talent_measurements set height_cm = 1 where talent_id = $1", [talentA]));
    const rows = await su("select height_cm::int as h from public.talent_measurements where talent_id = $1 order by measured_on", [talentA]);
    assert.deepEqual(rows.map((r) => r.h), [170, 172]);
    const current = await rowsAs(db, people.booker, "select height_cm::int as h from public.talent_current_measurements where talent_id = $1 and is_official", [talentA]);
    assert.equal(current[0].h, 172);
  });

  test("skills catalogue is seeded and edited only with skills.edit", async () => {
    assert.ok((await su("select 1 from public.skill_categories where name = 'Languages'")).length === 1);
    assert.ok(await rejects(db, users.creative, "insert into public.skill_categories (name) values ('Juggling')"));
    await as(db, people.booker, "insert into public.skills (category_id, name) select id, 'Spanish' from public.skill_categories where name = 'Languages'");
  });

  test("contacts accept only known relationships and stay private", async () => {
    assert.ok(await rejects(db, people.booker, "insert into public.talent_contacts (talent_id, name, relationship) values ($1, 'X', 'friend')", [talentA]));
    await as(db, people.booker, "insert into public.talent_contacts (talent_id, name, relationship) values ($1, 'Parent A', 'guardian')", [talentA]);
    assert.deepEqual(await rowsAs(db, users.creative, "select * from public.talent_contacts"), []);
  });

  test("agencies are managed by agency managers", async () => {
    await as(db, users.talentManager, "insert into public.agencies (name, country) values ('Fictional Models Paris', 'France')");
    assert.ok(await rejects(db, people.booker, "insert into public.agencies (name) values ('Nope Agency')"));
  });
});

describe("phase 6: media", () => {
  let photos;
  before(async () => {
    photos = [];
    for (const name of ["one", "two", "three"]) {
      photos.push((await one("insert into public.talent_photos (talent_id, storage_path, display_order) values ($1, $2, 0) returning id", [talentA, `talent/${talentA}/${name}.jpg`])).id);
    }
  });

  test("ordering persists and requires media.manage", async () => {
    await as(db, users.readOnly, "select public.reorder_talent_photos($1, $2::uuid[])", [talentA, [photos[2], photos[1], photos[0]]]);
    assert.equal((await one("select display_order from public.talent_photos where id = $1", [photos[2]])).display_order, 0);
    await as(db, users.creative, "select public.reorder_talent_photos($1, $2::uuid[])", [talentA, [photos[2], photos[1], photos[0]]]);
    const order = (await su("select id from public.talent_photos where talent_id = $1 order by display_order", [talentA])).map((r) => r.id);
    assert.deepEqual(order, [photos[2], photos[1], photos[0]]);
  });

  test("exactly one featured photo", async () => {
    await as(db, users.creative, "select public.set_featured_photo($1, $2)", [talentA, photos[0]]);
    await as(db, users.creative, "select public.set_featured_photo($1, $2)", [talentA, photos[1]]);
    const featured = (await su("select id from public.talent_photos where talent_id = $1 and featured", [talentA])).map((r) => r.id);
    assert.deepEqual(featured, [photos[1]]);
  });

  test("portfolios keep order and reject other talents' photos", async () => {
    const portfolio = (await (await as(db, users.creative, "insert into public.portfolios (talent_id, name, slug, public) values ($1, 'Commercial', 'commercial', true) returning id", [talentA])).rows[0]).id;
    await as(db, users.creative, "select public.set_portfolio_images($1, $2::uuid[])", [portfolio, [photos[1], photos[0]]]);
    const order = (await su("select photo_id from public.portfolio_images where portfolio_id = $1 order by display_order", [portfolio])).map((r) => r.photo_id);
    assert.deepEqual(order, [photos[1], photos[0]]);
    const other = (await one("insert into public.talent_photos (talent_id, storage_path) values ($1, 'talent/b/x.jpg') returning id", [talentB])).id;
    assert.ok(await rejects(db, users.creative, "insert into public.portfolio_images (portfolio_id, photo_id) values ($1, $2)", [portfolio, other]));
  });

  test("videos validate their source", async () => {
    assert.ok(await rejects(db, users.creative, "insert into public.talent_videos (talent_id, provider) values ($1, 'youtube')", [talentA]));
    await as(db, users.creative, "insert into public.talent_videos (talent_id, provider, external_id, public) values ($1, 'youtube', 'dQw4w9WgXcQ', true)", [talentA]);
  });

  test("digital books publish with a timestamp", async () => {
    const book = (await (await as(db, users.creative, "insert into public.digital_books (talent_id, name) values ($1, 'Digitals Sept') returning id", [talentA])).rows[0]).id;
    await as(db, users.creative, "select public.set_digital_book_images($1, $2::uuid[])", [book, [photos[0]]]);
    await as(db, users.creative, "update public.digital_books set public = true where id = $1", [book]);
    assert.ok((await one("select published_at from public.digital_books where id = $1", [book])).published_at);
  });
});

describe("phase 7: sensitive modules", () => {
  test("medical is isolated to owner and administrator", async () => {
    assert.deepEqual(await rowsAs(db, users.talentManager, "select * from public.talent_medical"), []);
    assert.deepEqual(await rowsAs(db, users.accounting, "select * from public.talent_medical"), []);
    assert.equal((await rowsAs(db, people.admin, "select * from public.talent_medical")).length, 1);
  });

  test("legal and banking are for owner, administrator, and accounting", async () => {
    await as(db, users.accounting, "insert into public.talent_legal (talent_id, passport_number, passport_expires_on) values ($1, 'X1234567', '2027-01-01')", [talentA]);
    for (const user of [users.creative, users.talentManager, people.booker, users.readOnly]) {
      assert.deepEqual(await rowsAs(db, user, "select * from public.talent_legal"), []);
      assert.deepEqual(await rowsAs(db, user, "select * from public.talent_banking"), []);
    }
    assert.equal((await rowsAs(db, users.accounting, "select * from public.talent_legal")).length, 1);
  });

  test("sensitive changes are audited without their values", async () => {
    await as(db, users.accounting, "update public.talent_banking set account_number = '999988887777' where talent_id = $1", [ids.publishedTalent]);
    const row = await one("select metadata from public.audit_logs where action = 'banking.update' order by created_at desc limit 1");
    assert.deepEqual(row.metadata.fields, ["account_number"]);
    assert.ok(!JSON.stringify(row).includes("999988887777"));
  });

  test("private documents are readable only with documents.view", async () => {
    await su("insert into storage.objects (bucket_id, name) values ('talent-documents', 'talent/a/contract.pdf')");
    assert.deepEqual(await rowsAs(db, "anon", "select * from storage.objects where bucket_id = 'talent-documents'"), []);
    assert.deepEqual(await rowsAs(db, users.creative, "select * from storage.objects where bucket_id = 'talent-documents'"), []);
    assert.equal((await rowsAs(db, users.accounting, "select * from storage.objects where bucket_id = 'talent-documents'")).length, 1);
    assert.ok(await rejects(db, users.creative, "insert into storage.objects (bucket_id, name) values ('talent-documents', 'talent/a/evil.pdf')"));
  });

  test("document records are archived, not deleted", async () => {
    await as(db, users.accounting, "insert into public.talent_documents (talent_id, file_name, storage_path) values ($1, 'contract.pdf', 'talent/a/contract.pdf')", [talentA]);
    await rowsAs(db, users.accounting, "delete from public.talent_documents where talent_id = $1", [talentA]);
    assert.equal((await su("select 1 from public.talent_documents where talent_id = $1", [talentA])).length, 1);
  });
});
