// Phase 12: website CMS. Drafts stay private, publishing snapshots a revision,
// rollback restores one, and anon sees only live content. Run: npm run test:rls
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addMember, as, createDatabase, newUser, rejects, rowsAs, users } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;
const people = {};
let pageId;

before(async () => {
  db = await createDatabase();
  people.admin = await addMember(db, newUser("admin"), "administrator");
  const { rows: [page] } = await as(db, users.owner, `insert into public.website_pages (slug, title, sections, status, published_revision_id)
    values ('campaign', 'Campaign', '[{"id":"a","type":"rich_text","data":{"body":"Version one"}}]', 'published', null) returning id, status`);
  pageId = page.id;
  assert.equal(page.status, "draft", "inserts are forced to draft");
});

describe("phase 12: CMS drafts and publishing", () => {
  test("seeded pages are drafts and invisible to the public", async () => {
    assert.deepEqual(await rowsAs(db, "anon", "select slug from public.public_pages_view"), []);
    const seeded = await su("select slug, status from public.website_pages where slug in ('about', 'privacy', 'terms') order by slug");
    assert.deepEqual(seeded, [{ slug: "about", status: "draft" }, { slug: "privacy", status: "draft" }, { slug: "terms", status: "draft" }]);
  });

  test("only website editors can read or edit pages", async () => {
    assert.deepEqual(await rowsAs(db, users.talentManager, "select id from public.website_pages"), []);
    assert.ok(await rejects(db, users.creative, "insert into public.website_pages (slug, title) values ('x', 'X')"));
    assert.equal((await rowsAs(db, people.admin, "select id from public.website_pages")).length >= 4, true);
  });

  test("status cannot be flipped to published by a plain update", async () => {
    assert.ok(await rejects(db, users.owner, `update public.website_pages set status = 'published' where id = '${pageId}'`));
  });

  test("publishing snapshots the working copy and makes it public", async () => {
    await as(db, users.owner, `select public.publish_website_page('${pageId}')`);
    const live = await rowsAs(db, "anon", "select slug, title, sections from public.public_pages_view where slug = 'campaign'");
    assert.equal(live.length, 1);
    assert.equal(live[0].sections[0].data.body, "Version one");
    assert.equal((await su("select 1 from public.audit_logs where action = 'cms.page_published' and entity_id = $1", [pageId])).length, 1);
  });

  test("edits stay private until the next publish", async () => {
    await as(db, users.owner, `update public.website_pages set sections = '[{"id":"a","type":"rich_text","data":{"body":"Version two"}}]' where id = '${pageId}'`);
    const [page] = await su("select has_unpublished_changes from public.website_pages where id = $1", [pageId]);
    assert.equal(page.has_unpublished_changes, true);
    const [live] = await rowsAs(db, "anon", "select sections from public.public_pages_view where slug = 'campaign'");
    assert.equal(live.sections[0].data.body, "Version one");
    await as(db, users.owner, `select public.publish_website_page('${pageId}')`);
    const [updated] = await rowsAs(db, "anon", "select sections from public.public_pages_view where slug = 'campaign'");
    assert.equal(updated.sections[0].data.body, "Version two");
  });

  test("anon cannot read drafts, old revisions, or the working copy", async () => {
    assert.ok(await rejects(db, "anon", "select sections from public.website_pages"));
    const revisions = await rowsAs(db, "anon", "select sections from public.website_page_revisions");
    assert.equal(revisions.length, 1, "only the live revision is readable");
    assert.equal(revisions[0].sections[0].data.body, "Version two");
  });

  test("restoring a revision replaces the working copy, then publish makes it live", async () => {
    const [first] = await su("select id from public.website_page_revisions where page_id = $1 and version = 1", [pageId]);
    await as(db, users.owner, `select public.restore_website_revision('${first.id}')`);
    const [page] = await su("select sections from public.website_pages where id = $1", [pageId]);
    assert.equal(page.sections[0].data.body, "Version one");
    const [live] = await rowsAs(db, "anon", "select sections from public.public_pages_view where slug = 'campaign'");
    assert.equal(live.sections[0].data.body, "Version two", "still live until republished");
  });

  test("published pages cannot be deleted; unpublishing hides them", async () => {
    await rowsAs(db, users.owner, `delete from public.website_pages where id = '${pageId}'`);
    assert.equal((await su("select 1 from public.website_pages where id = $1", [pageId])).length, 1);
    await as(db, users.owner, `select public.unpublish_website_page('${pageId}')`);
    assert.deepEqual(await rowsAs(db, "anon", "select slug from public.public_pages_view where slug = 'campaign'"), []);
    await as(db, users.owner, `delete from public.website_pages where id = '${pageId}'`);
    assert.equal((await su("select 1 from public.website_pages where id = $1", [pageId])).length, 0);
  });

  test("roles without website.publish cannot publish", async () => {
    const [about] = await su("select id from public.website_pages where slug = 'about'");
    assert.ok(await rejects(db, users.talentManager, `select public.publish_website_page('${about.id}')`));
  });
});

describe("phase 12: navigation, settings, redirects", () => {
  test("anon sees visible navigation and public settings only", async () => {
    await su("insert into public.website_settings (key, value, is_public) values ('internal_note', '\"secret\"', false)");
    const settings = await rowsAs(db, "anon", "select key from public.public_settings_view order by key");
    assert.ok(settings.some((row) => row.key === "contact_email"));
    assert.ok(!settings.some((row) => row.key === "internal_note"));
    const nav = await rowsAs(db, "anon", "select label from public.public_navigation_view where location = 'footer' order by sort_order");
    assert.deepEqual(nav.map((row) => row.label), ["About", "Join us", "Privacy", "Terms"]);
  });

  test("navigation hrefs reject javascript: URLs", async () => {
    assert.ok(await rejects(db, users.owner, "insert into public.website_navigation (label, href) values ('x', 'javascript:alert(1)')"));
  });

  test("redirects are public when active and hits can be counted by anyone", async () => {
    await as(db, users.owner, "insert into public.website_redirects (from_path, to_path) values ('/old-models', '/models')");
    const rows = await rowsAs(db, "anon", "select to_path, permanent from public.website_redirects where from_path = '/old-models'");
    assert.deepEqual(rows, [{ to_path: "/models", permanent: true }]);
    await as(db, "anon", "select public.record_redirect_hit('/old-models')");
    assert.equal((await su("select hits from public.website_redirects where from_path = '/old-models'"))[0].hits, 1);
    assert.ok(await rejects(db, "anon", "update public.website_redirects set to_path = 'https://evil.example'"));
  });

  test("the public media bucket no longer accepts SVG", async () => {
    const [bucket] = await su("select allowed_mime_types from storage.buckets where id = 'cms-media'");
    assert.ok(!bucket.allowed_mime_types.includes("image/svg+xml"));
  });
});

describe("phase 12: open-redirect protection", () => {
  test("redirect targets and navigation links cannot be protocol-relative", async () => {
    for (const target of ["//evil.example", String.raw`/\evil.example`, "http://insecure.example", "javascript:alert(1)"]) {
      assert.ok(await rejects(db, users.owner, "insert into public.website_redirects (from_path, to_path) values ($1, $2)", [`/r-${target.length}-${Math.random()}`, target]), target);
    }
    for (const href of ["//evil.example", String.raw`/\evil.example`]) {
      assert.ok(await rejects(db, users.owner, "insert into public.website_navigation (label, href) values ('x', $1)", [href]), href);
    }
    await as(db, users.owner, "insert into public.website_redirects (from_path, to_path) values ('/ok-1', '/models'), ('/ok-2', 'https://instagram.com/x'), ('/ok-3', '/')");
  });
});
