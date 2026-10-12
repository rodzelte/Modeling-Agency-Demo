// Phase 20: CDS / WebForFashion import staging (migration 029).
// Run: node --test tests/rls/cds-import.test.mjs
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { as, createDatabase, ids, rejects, rowsAs, users } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;

before(async () => {
  db = await createDatabase();
});

describe("phase 20: CDS import staging", () => {
  test("the owner writes staging rows; others cannot", async () => {
    await as(db, users.owner, "insert into public.cds_talents (cds_id, wff_id, first_name, last_name, email) values ('1429427', '138421', 'Alayla', 'Weatherspoon', 'a@example.test')");
    await as(db, users.owner, "insert into public.cds_media (wff_media_id, cds_id, kind, position) values ('8904239', '1429427', 'image', 0)");
    await as(db, users.owner, "insert into public.cds_portfolio_boards (portfolio_name, mapping_source) values ('Fashion-Women', 'auto')");
    assert.ok(await rejects(db, users.talentManager, "insert into public.cds_talents (cds_id) values ('x1')"));
    assert.ok(await rejects(db, users.creative, "insert into public.cds_media (wff_media_id, cds_id) values ('x2', '1429427')"));
    assert.ok(await rejects(db, "anon", "select * from public.cds_talents"));
  });

  test("contact details are readable only with integration and private-data access", async () => {
    assert.equal((await rowsAs(db, users.owner, "select email from public.cds_talents")).length, 1);
    assert.equal((await rowsAs(db, users.talentManager, "select email from public.cds_talents")).length, 1);
    assert.deepEqual(await rowsAs(db, users.creative, "select email from public.cds_talents"), []);
    assert.deepEqual(await rowsAs(db, users.readOnly, "select * from public.cds_media"), []);
  });

  test("a CDS record links to at most one talent, and linking is audited", async () => {
    await as(db, users.owner, "update public.cds_talents set talent_id = $1, match_status = 'matched', match_reason = 'email' where cds_id = '1429427'", [ids.draftTalent]);
    const [audit] = await su("select metadata from public.audit_logs where action = 'cds.linked' and entity_id = $1", [ids.draftTalent]);
    assert.equal(audit.metadata.cds_id, "1429427");
    await as(db, users.owner, "insert into public.cds_talents (cds_id, first_name) values ('1403614', 'Alejandra')");
    assert.ok(await rejects(db, users.owner, "update public.cds_talents set talent_id = $1 where cds_id = '1403614'", [ids.draftTalent]));
  });

  test("imported measurements and photos may be marked as coming from CDS", async () => {
    await as(db, users.owner, "insert into public.talent_measurements (talent_id, height_cm, is_official, source) values ($1, 175, true, 'cds')", [ids.draftTalent]);
    await as(db, users.owner, "insert into public.talent_photos (talent_id, storage_path, source, external_id) values ($1, 'x/cds.jpg', 'cds', 'cds-1')", [ids.draftTalent]);
    assert.ok(await rejects(db, users.owner, "insert into public.talent_measurements (talent_id, source) values ($1, 'elsewhere')", [ids.draftTalent]));
  });

  test("statuses and media kinds are constrained", async () => {
    assert.ok(await rejects(db, users.owner, "update public.cds_talents set match_status = 'merged' where cds_id = '1429427'"));
    assert.ok(await rejects(db, users.owner, "insert into public.cds_media (wff_media_id, cds_id, kind) values ('x3', '1429427', 'pdf')"));
  });
});
