// Phase 16: generated security checks over the whole schema. They fail when a new
// table, view, function or grant is added without the matching protection, so
// security does not depend on remembering every rule. Run: npm run test:rls
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, rejects } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;

// Anonymous visitors may read exactly these relations (public site, CMS, packages).
const ANON_READABLE = new Set([
  // Public-safe views.
  "public_boards_view", "public_talents_view", "public_talent_media_view", "public_talent_portfolios_view", "public_talent_skills_view",
  "public_pages_view", "public_navigation_view", "public_settings_view",
  // Base tables behind those security_invoker views (anon-only row policies + column grants).
  "talent", "talent_photos", "talent_measurements", "talent_board_assignments", "boards", "talent_videos", "portfolios", "portfolio_images",
  "digital_books", "digital_book_images", "talent_skills", "skill_categories", "skills",
  "website_pages", "website_page_revisions", "website_navigation", "website_settings", "website_redirects",
]);

// Functions anonymous visitors may call.
const ANON_CALLABLE = new Set(["talent_public_age", "talent_is_public", "get_shared_package", "record_redirect_hit"]);

before(async () => {
  db = await createDatabase();
});

describe("phase 16: schema-wide security rules", () => {
  test("every table in public has row-level security enabled", async () => {
    const rows = await su(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`);
    assert.deepEqual(rows.map((row) => row.relname), []);
  });

  test("every view in public runs with the caller's rights", async () => {
    const rows = await su(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions @> array['security_invoker=true'], false) order by 1`);
    assert.deepEqual(rows.map((row) => row.relname), []);
  });

  test("new tables do not grant anonymous visitors anything by default", async () => {
    await su("create table public.hardening_probe (id int)");
    const { rows: [row] } = await db.query("select has_table_privilege('anon', 'public.hardening_probe', 'SELECT') as can_read, has_table_privilege('anon', 'public.hardening_probe', 'INSERT') as can_write");
    await su("drop table public.hardening_probe");
    assert.deepEqual(row, { can_read: false, can_write: false });
  });

  test("anonymous visitors can write to nothing", async () => {
    const rows = await su(`select c.relname, p.privilege from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(privilege)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v') and has_table_privilege('anon', c.oid, p.privilege) order by 1`);
    assert.deepEqual(rows, []);
    const columnWrites = await su(`select table_name, column_name, privilege_type from information_schema.column_privileges
      where grantee = 'anon' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE')`);
    assert.deepEqual(columnWrites, []);
  });

  test("anonymous visitors can read only the allow-listed relations", async () => {
    const rows = await su(`select distinct c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
        and (has_table_privilege('anon', c.oid, 'SELECT') or has_any_column_privilege('anon', c.oid, 'SELECT')) order by 1`);
    const unexpected = rows.map((row) => row.relname).filter((name) => !ANON_READABLE.has(name));
    assert.deepEqual(unexpected, [], "new anon-readable relation: add a policy review, then the allow-list");
  });

  test("anonymous visitors can call only the allow-listed functions", async () => {
    const rows = await su(`select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
        -- Extension functions (pgcrypto in the test harness) are not ours to grant.
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1`);
    const unexpected = rows.map((row) => row.proname).filter((name) => !ANON_CALLABLE.has(name));
    assert.deepEqual(unexpected, []);
  });

  test("every SECURITY DEFINER function pins its search_path", async () => {
    const rows = await su(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false) order by 1`);
    assert.deepEqual(rows.map((row) => row.proname), []);
  });

  test("trigger functions are not callable through the API", async () => {
    const rows = await su(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`);
    assert.deepEqual(rows.map((row) => row.proname), []);
  });

  test("anonymous visitors cannot write to any storage bucket", async () => {
    const buckets = (await su("select id from storage.buckets order by id")).map((row) => row.id);
    for (const bucket of buckets) assert.ok(await rejects(db, "anon", "insert into storage.objects (bucket_id, name) values ($1, 'probe.jpg')", [bucket]), bucket);
  });

  test("the archive schema is not reachable through the API", async () => {
    const rows = await su("select has_schema_privilege('anon', 'archive', 'USAGE') as anon, has_schema_privilege('authenticated', 'archive', 'USAGE') as auth");
    assert.deepEqual(rows[0], { anon: false, auth: false });
  });

  test("every permission is granted to the owner", async () => {
    const rows = await su("select p.key from public.permissions p where not exists (select 1 from public.role_permissions rp where rp.role_key = 'owner' and rp.permission_key = p.key) order by 1");
    assert.deepEqual(rows.map((row) => row.key), []);
  });
});

describe("phase 16: permission matrix guard rails", () => {
  test("the owner's permissions cannot be removed", async () => {
    await su("select set_config('request.jwt.claims', '', false)");
    await assert.rejects(db.query("delete from public.role_permissions where role_key = 'owner' and permission_key = 'banking.view'"));
  });

  test("the talent role can never be given staff permissions", async () => {
    await assert.rejects(db.query("insert into public.role_permissions (role_key, permission_key) values ('talent', 'talent.view')"));
  });

  test("matrix changes are audited", async () => {
    await su("insert into public.role_permissions (role_key, permission_key) values ('creative', 'notes.view') on conflict do nothing");
    await su("delete from public.role_permissions where role_key = 'creative' and permission_key = 'notes.view'");
    const actions = (await su("select action from public.audit_logs where entity_type = 'role_permission' order by created_at")).map((row) => row.action);
    assert.deepEqual(actions.slice(-2), ["permission.granted", "permission.revoked"]);
  });
});
