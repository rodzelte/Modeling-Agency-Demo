// The full demo seed (supabase/demo/seed.sql + generated files), loaded exactly
// as the demo server loads it. Run: npm run test:demo
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { getSandbox, type Sandbox } from "../../src/demo/sandbox/database.ts";
import { sandboxFetch } from "../../src/demo/sandbox/fetch.ts";
import { DEMO_ANON_KEY } from "../../src/demo/sandbox/jwt.ts";
import { seedDemo } from "../../src/demo/seed/index.ts";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../../src/demo/accounts.ts";

let sandbox: Sandbox;
const client = () => createClient("http://sandbox.demo.invalid", DEMO_ANON_KEY, {
  global: { fetch: (input, init) => sandboxFetch(input, init) },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const count = async (sql: string) => (await sandbox.db.query<{ n: number }>(`select count(*)::int as n from (${sql}) s`)).rows[0].n;

before(async () => { sandbox = await getSandbox(seedDemo); });
after(async () => { await sandbox.db.close(); });

test("every demo account signs in and lands in the right area", async () => {
  for (const account of DEMO_ACCOUNTS) {
    const supabase = client();
    const { error } = await supabase.auth.signInWithPassword({ email: account.email, password: DEMO_PASSWORD });
    assert.equal(error, null, `${account.key} can sign in`);
    const { data: member } = await supabase.from("agency_members").select("role,status,talent_id").eq("user_id", account.id).maybeSingle();
    assert.equal(member?.role, account.role, `${account.key} has the ${account.role} role`);
    assert.equal(member?.status, "active");
    const { data: permissions } = await supabase.rpc("current_permissions");
    if (account.area === "dashboard") assert.ok((permissions as string[]).includes("dashboard.access"), `${account.key} can open the dashboard`);
    else {
      assert.ok(member?.talent_id, "the talent login is linked to a talent record");
      assert.ok(!(permissions as string[]).includes("dashboard.access"), "a talent login has no dashboard access");
      const { data: profile, error: profileError } = await supabase.rpc("portal_profile");
      assert.equal(profileError, null);
      assert.ok(profile, "the portal profile loads");
    }
  }
});

test("every module has sample records", async () => {
  const minimums: Record<string, number> = {
    talent: 20, talent_photos: 80, talent_measurements: 20, talent_private_details: 20, talent_documents: 5, talent_appointments: 5,
    applications: 10, companies: 8, company_contacts: 8, bookings: 12, booking_talent: 12, booking_financials: 6, tasks: 10,
    packages: 3, package_items: 6, talent_change_requests: 2, talent_availability: 3, website_pages: 4, website_navigation: 4,
    ghl_pipelines: 2, ghl_pipeline_stages: 6, ghl_contacts: 20, ghl_opportunities: 10, ghl_sync_runs: 3, cds_talents: 8,
    subscription_plans: 1, talent_subscriptions: 2, portfolios: 6, digital_books: 3, audit_logs: 50,
  };
  for (const [table, minimum] of Object.entries(minimums)) {
    const rows = await count(`select 1 from public.${table}`);
    assert.ok(rows >= minimum, `${table}: ${rows} rows, expected at least ${minimum}`);
  }
});

test("the public website has content, and only what is meant to be public", async () => {
  const anon = client();
  const { data: talents } = await anon.from("public_talents_view").select("talent_id:id,slug,primary_image_path").limit(100);
  assert.ok((talents ?? []).length >= 15, "published talent are visible");
  assert.ok((talents ?? []).every((talent) => talent.primary_image_path), "every public talent has a primary image");
  assert.ok(((await anon.from("public_pages_view").select("slug")).data ?? []).length >= 3, "published pages are visible");
  assert.ok(((await anon.from("public_boards_view").select("slug")).data ?? []).length >= 6, "public boards are visible");
  const unpublished = await count("select 1 from public.talent where publication_status <> 'published'");
  assert.ok(unpublished >= 3, "the workspace also holds drafts and archived talent");
  for (const table of ["talent_private_details", "talent_banking", "talent_legal", "bookings", "companies", "applications", "ghl_contacts"]) {
    const { data } = await anon.from(table).select("*").limit(1);
    assert.deepEqual(data ?? [], [], `${table} is closed to anonymous visitors`);
  }
});

test("every file a record points to exists", async () => {
  const paths = await sandbox.db.query<{ key: string }>(`
    select storage_bucket || '/' || storage_path as key from public.talent_photos
    union all select 'talent-public/' || public_storage_path from public.talent_photos where public_storage_path is not null
    union all select 'talent-documents/' || storage_path from public.talent_documents
    union all select 'applications/' || storage_path from public.application_photos where storage_path is not null`);
  assert.ok(paths.rows.length > 100);
  const missing = paths.rows.map((row) => row.key).filter((key) => !sandbox.files.has(key));
  assert.deepEqual(missing, []);
  assert.equal(await count("select 1 from storage.objects"), sandbox.files.size, "storage rows and stored files match");
});

test("the sample people are fictional", async () => {
  const emails = await sandbox.db.query<{ email: string }>(`
    select email from public.agency_members union select email from public.talent_private_details where email is not null
    union select email from public.applications where email is not null union select email from public.companies where email is not null
    union select email from public.company_contacts where email is not null union select email from public.ghl_contacts where email is not null`);
  assert.ok(emails.rows.length > 50);
  assert.deepEqual(emails.rows.map((row) => row.email).filter((email) => !/\.example$/i.test(email)), [], "only reserved .example addresses");
});
