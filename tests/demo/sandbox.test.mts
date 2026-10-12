// The demo sandbox, driven through the real supabase-js client exactly as the app
// drives it: full create / read / update / delete, RLS, storage, sign-in, and
// "Reset demo data". Run: npm run test:demo
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PGlite } from "@electric-sql/pglite";
import { getSandbox, resetSandbox, type StoredFile } from "../../src/demo/sandbox/database.ts";
import { sandboxFetch } from "../../src/demo/sandbox/fetch.ts";
import { DEMO_ANON_KEY, serviceRoleKey } from "../../src/demo/sandbox/jwt.ts";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, demoAccount } from "../../src/demo/accounts.ts";

const SANDBOX_URL = "http://sandbox.demo.invalid";

// Every network call the test process attempts is recorded: the sandbox must
// answer everything itself.
const realFetch = globalThis.fetch;
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push(String(input instanceof Request ? input.url : input));
  throw new Error("Network access is not allowed in sandbox tests");
}) as typeof fetch;

// A small fixed data set (the full demo seed is checked by seed.test.mts).
async function seed(db: PGlite, files: Map<string, StoredFile>) {
  void files;
  const users = DEMO_ACCOUNTS.filter((account) => account.area === "dashboard")
    .map((account) => `('${account.id}', '${account.email}', crypt('${DEMO_PASSWORD}', gen_salt('bf', 4)), now(), '{"full_name":"${account.name}"}'::jsonb)`);
  await db.exec(`insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ${users.join(", ")};`);
  const members = DEMO_ACCOUNTS.filter((account) => account.area === "dashboard").map((account) => `('${account.email}', '${account.name}', '${account.role}', 'active')`);
  await db.exec(`insert into public.agency_members (email, full_name, role, status) values ${members.join(", ")};`);
  await db.exec(`insert into public.companies (id, name, kind, city) values
    ('c0000000-0000-4000-8000-000000000001', 'Seeded Client One', 'client', 'Dallas'),
    ('c0000000-0000-4000-8000-000000000002', 'Seeded Photo Studio', 'photographer', 'Austin');`);
}

function client(): SupabaseClient {
  return createClient(SANDBOX_URL, DEMO_ANON_KEY, {
    global: { fetch: (input, init) => sandboxFetch(input, init) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signedIn(key: string): Promise<SupabaseClient> {
  const supabase = client();
  const { error } = await supabase.auth.signInWithPassword({ email: demoAccount(key)!.email, password: DEMO_PASSWORD });
  assert.equal(error, null, `sign in as ${key}`);
  return supabase;
}

let owner: SupabaseClient;
let readOnly: SupabaseClient;
const anon = client();

before(async () => {
  await getSandbox(seed);
  owner = await signedIn("owner");
  readOnly = await signedIn("read_only");
});

after(async () => {
  globalThis.fetch = realFetch;
  await (await getSandbox()).db.close();
});

describe("sign-in", () => {
  test("a wrong password is rejected", async () => {
    const { data, error } = await client().auth.signInWithPassword({ email: demoAccount("owner")!.email, password: "not-the-password" });
    assert.equal(data.session, null);
    assert.equal(error?.message, "Invalid login credentials");
  });

  test("the session identifies the user and their permissions come from the database", async () => {
    const { data: { user } } = await owner.auth.getUser();
    assert.equal(user?.id, demoAccount("owner")!.id);
    const { data: permissions, error } = await owner.rpc("current_permissions");
    assert.equal(error, null);
    assert.ok(Array.isArray(permissions) && permissions.length > 20, "owner holds the full permission set");
    const { data: none } = await anon.rpc("current_permissions");
    assert.deepEqual(none ?? [], []);
  });

  test("the membership is bound to the account", async () => {
    const { data, error } = await owner.from("agency_members").select("role,status,user_id").eq("user_id", demoAccount("owner")!.id).maybeSingle();
    assert.equal(error, null);
    assert.deepEqual(data, { role: "owner", status: "active", user_id: demoAccount("owner")!.id });
  });

  test("a new teammate account can sign in and change their password", async () => {
    const email = "new.teammate@northlight-demo.example";
    const added = await owner.from("agency_members").insert({ email, full_name: "New Teammate", role: "booker", status: "active" }).select("id,user_id").single();
    assert.equal(added.error, null);
    const signUp = await client().auth.signUp({ email, password: "temporary-pass-1", options: { data: { full_name: "New Teammate", must_change_password: true } } });
    assert.equal(signUp.error, null);
    assert.equal(signUp.data.user?.identities?.length, 1);
    const again = await client().auth.signUp({ email, password: "temporary-pass-1" });
    assert.equal(again.data.user?.identities?.length, 0, "an existing address is not created twice");

    const teammate = client();
    assert.equal((await teammate.auth.signInWithPassword({ email, password: "temporary-pass-1" })).error, null);
    const { data: bound } = await teammate.from("agency_members").select("role,user_id").eq("email", email).maybeSingle();
    assert.equal(bound?.role, "booker");
    assert.ok(bound?.user_id, "the account is bound to the approved membership");
    const changed = await teammate.auth.updateUser({ password: "my-own-password-2", data: { must_change_password: false } });
    assert.equal(changed.error, null);
    assert.equal(changed.data.user?.user_metadata.must_change_password, false);
    await teammate.auth.signOut();
    assert.equal((await client().auth.signInWithPassword({ email, password: "temporary-pass-1" })).data.session, null);
    assert.notEqual((await client().auth.signInWithPassword({ email, password: "my-own-password-2" })).data.session, null);
  });
});

describe("create, read, update, delete", () => {
  test("companies: the full cycle, with returned rows", async () => {
    const created = await owner.from("companies").insert({ name: "Atelier Verano", kind: "brand", city: "Houston" }).select("id,name,kind,created_by").single();
    assert.equal(created.error, null);
    assert.equal(created.data?.created_by, demoAccount("owner")!.id, "defaults and auth.uid() apply");
    const id = created.data!.id as string;

    const listed = await owner.from("companies").select("id,name", { count: "exact" }).order("name").range(0, 1);
    assert.equal(listed.count, 3);
    assert.deepEqual(listed.data?.map((row) => row.name), ["Atelier Verano", "Seeded Client One"]);

    const updated = await owner.from("companies").update({ city: "San Antonio", notes: "Prefers morning call times" }).eq("id", id).select("id,city,notes").maybeSingle();
    assert.deepEqual(updated.data, { id, city: "San Antonio", notes: "Prefers morning call times" });

    const contact = await owner.from("company_contacts").insert({ company_id: id, name: "Lucia Verano", title: "Creative director", is_primary: true }).select("id").single();
    assert.equal(contact.error, null);
    const embedded = await owner.from("company_contacts").select("id,name,company:company_id(id,name)").eq("id", contact.data!.id).single();
    assert.deepEqual(embedded.data?.company, { id, name: "Atelier Verano" });

    const removed = await owner.from("companies").delete().eq("id", id).select("id").maybeSingle();
    assert.equal(removed.data?.id, id);
    assert.equal((await owner.from("companies").select("id").eq("id", id).maybeSingle()).data, null);
    assert.equal((await owner.from("company_contacts").select("id", { count: "exact", head: true }).eq("company_id", id)).count, 0, "contacts cascade");
  });

  test("filters: or, ilike, in, is, not, neq, single", async () => {
    const or = await owner.from("companies").select("name").or("name.ilike.%photo%,city.ilike.%dallas%").order("name");
    assert.deepEqual(or.data?.map((row) => row.name), ["Seeded Client One", "Seeded Photo Studio"]);
    const within = await owner.from("companies").select("name").in("kind", ["photographer", "casting"]);
    assert.deepEqual(within.data?.map((row) => row.name), ["Seeded Photo Studio"]);
    const nulls = await owner.from("companies").select("id", { count: "exact", head: true }).is("website", null).not("city", "is", null).neq("kind", "client");
    assert.equal(nulls.count, 1);
    const missing = await owner.from("companies").select("id").eq("name", "Nobody").single();
    assert.equal(missing.error?.code, "PGRST116");
  });

  test("talent, boards and bookings: embedded relations, inner joins, upserts, RPC", async () => {
    const talent = await owner.from("talent").insert({ first_name: "Noor", last_name: "Hadley", display_name: "Noor Hadley", slug: "noor-hadley", gender: "Female", location: "Dallas, TX" }).select("id,display_name,publication_status").single();
    assert.equal(talent.error, null);
    const talentId = talent.data!.id as string;

    const details = await owner.from("talent_private_details").upsert({ talent_id: talentId, mobile: "555-0142", email: "noor@talent-demo.example" }, { onConflict: "talent_id" });
    assert.equal(details.error, null);
    const again = await owner.from("talent_private_details").upsert({ talent_id: talentId, mobile: "555-0199" }, { onConflict: "talent_id" });
    assert.equal(again.error, null);
    const stored = await owner.from("talent_private_details").select("mobile,email").eq("talent_id", talentId).single();
    assert.deepEqual(stored.data, { mobile: "555-0199", email: "noor@talent-demo.example" });

    const { data: boards } = await owner.from("boards").select("id,slug").order("sort_order").limit(2);
    const assigned = await owner.from("talent_board_assignments").insert(boards!.map((board) => ({ talent_id: talentId, board_id: board.id })));
    assert.equal(assigned.error, null);
    const withBoards = await owner.from("talent").select("id,talent_board_assignments(board_id,boards(id,slug))").eq("id", talentId).single();
    assert.equal((withBoards.data?.talent_board_assignments as unknown[]).length, 2);
    const onBoard = await owner.from("talent").select("id,talent_board_assignments!inner(board_id)", { count: "exact" }).eq("talent_board_assignments.board_id", boards![0].id);
    assert.equal(onBoard.count, 1);
    const onNoBoard = await owner.from("talent").select("id,talent_board_assignments!inner(board_id)", { count: "exact" }).eq("talent_board_assignments.board_id", "00000000-0000-4000-8000-000000000000");
    assert.equal(onNoBoard.count, 0);

    const start = new Date(Date.now() + 3 * 86400000);
    const end = new Date(start.getTime() + 4 * 3600000);
    const booking = await owner.from("bookings").insert({ title: "Spring lookbook", booking_type: "shoot", status: "confirmed", company_id: "c0000000-0000-4000-8000-000000000001", start_at: start.toISOString(), end_at: end.toISOString() }).select("id,reference").single();
    assert.equal(booking.error, null);
    assert.match(booking.data!.reference as string, /^BK-\d{5}$/);
    assert.equal((await owner.from("booking_talent").insert({ booking_id: booking.data!.id, talent_id: talentId })).error, null);
    const full = await owner.from("bookings").select("id,title,company:company_id(id,name),booking_talent(talent:talent_id(id,display_name))").eq("id", booking.data!.id).single();
    assert.deepEqual(full.data?.company, { id: "c0000000-0000-4000-8000-000000000001", name: "Seeded Client One" });
    assert.deepEqual(full.data?.booking_talent, [{ talent: { id: talentId, display_name: "Noor Hadley" } }]);

    const money = await owner.from("booking_financials").upsert({ booking_id: booking.data!.id, fee_total: 2400, currency: "USD" }, { onConflict: "booking_id" });
    assert.equal(money.error, null);
    const withMoney = await owner.from("bookings").select("id,booking_financials(fee_total,currency)").eq("id", booking.data!.id).single();
    const financials = withMoney.data?.booking_financials as unknown;
    assert.equal(Number((Array.isArray(financials) ? financials[0] : financials as { fee_total: number }).fee_total), 2400);

    const conflicts = await owner.rpc("talent_booking_conflicts", { p_talent_ids: [talentId], p_start: start.toISOString(), p_end: end.toISOString(), p_exclude_booking: null });
    assert.equal(conflicts.error, null);
    assert.equal((conflicts.data as unknown[]).length, 1, "the new booking is reported as a clash for the same hours");

    const audit = await owner.from("audit_logs").select("action,actor:actor_id(email)").eq("entity_id", talentId).order("created_at").limit(1);
    assert.equal(audit.error, null);
  });
});

describe("permissions are enforced by the database", () => {
  test("a read-only member can read but not write", async () => {
    assert.equal((await readOnly.from("companies").select("id", { count: "exact", head: true })).count, 2);
    const insert = await readOnly.from("companies").insert({ name: "Should Not Exist" }).select("id").single();
    assert.equal(insert.error?.code, "42501");
    const update = await readOnly.from("companies").update({ name: "Changed" }).eq("id", "c0000000-0000-4000-8000-000000000001").select("id");
    assert.deepEqual(update.data, []);
    assert.equal((await owner.from("companies").select("name").eq("id", "c0000000-0000-4000-8000-000000000001").single()).data?.name, "Seeded Client One");
  });

  test("an anonymous visitor sees no private tables", async () => {
    assert.deepEqual((await anon.from("companies").select("id")).data ?? [], []);
    assert.deepEqual((await anon.from("agency_members").select("id")).data ?? [], []);
    const privateRead = await anon.from("talent_private_details").select("mobile");
    assert.ok(privateRead.error || (privateRead.data ?? []).length === 0);
  });

  test("the HTTP bridge never accepts the service role", async () => {
    const headers = { apikey: DEMO_ANON_KEY, authorization: `Bearer ${serviceRoleKey()}` };
    const inProcess = await sandboxFetch(`${SANDBOX_URL}/rest/v1/talent_private_details?select=talent_id`, { headers });
    assert.equal(inProcess.status, 200);
    const overHttp = await sandboxFetch(`${SANDBOX_URL}/rest/v1/talent_private_details?select=talent_id`, { headers }, { external: true });
    assert.equal(overHttp.status, 401);
  });
});

describe("storage", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

  test("upload, signed link, public copy, list and remove", async () => {
    const { data: talent } = await owner.from("talent").select("id").eq("slug", "noor-hadley").single();
    const path = `${talent!.id}/test-photo.png`;
    const uploaded = await owner.storage.from("talent-private").upload(path, new Blob([png], { type: "image/png" }), { contentType: "image/png" });
    assert.equal(uploaded.error, null);
    const duplicate = await owner.storage.from("talent-private").upload(path, new Blob([png], { type: "image/png" }), { contentType: "image/png" });
    assert.ok(duplicate.error, "a second upload to the same path is refused");

    const signed = await owner.storage.from("talent-private").createSignedUrls([path, "missing/file.png"], 60);
    assert.ok(signed.data?.[0].signedUrl);
    assert.equal(signed.data?.[1].signedUrl, null);
    const fetched = await sandboxFetch(signed.data![0].signedUrl!, undefined, { external: true });
    assert.equal(fetched.status, 200);
    assert.deepEqual(new Uint8Array(await fetched.arrayBuffer()), png);
    const tampered = await sandboxFetch(signed.data![0].signedUrl!.replace("test-photo", "other-photo"), undefined, { external: true });
    assert.notEqual(tampered.status, 200);
    assert.notEqual((await sandboxFetch(`${SANDBOX_URL}/storage/v1/object/public/talent-private/${path}`, undefined, { external: true })).status, 200, "a private bucket has no public links");

    const copied = await owner.storage.from("talent-private").copy(path, `${talent!.id}/public-copy.png`, { destinationBucket: "talent-public" });
    assert.equal(copied.error, null);
    const publicUrl = owner.storage.from("talent-public").getPublicUrl(`${talent!.id}/public-copy.png`).data.publicUrl;
    assert.equal((await sandboxFetch(publicUrl, undefined, { external: true })).status, 200);

    const denied = await readOnly.storage.from("talent-private").upload(`${talent!.id}/nope.png`, new Blob([png], { type: "image/png" }), { contentType: "image/png" });
    assert.ok(denied.error, "upload needs media.manage");
    const wrongType = await owner.storage.from("talent-private").upload(`${talent!.id}/notes.txt`, new Blob(["hello"], { type: "text/plain" }), { contentType: "text/plain" });
    assert.ok(wrongType.error, "bucket mime types are enforced");

    const removed = await owner.storage.from("talent-private").remove([path]);
    assert.equal(removed.data?.length, 1);
    assert.notEqual((await sandboxFetch(signed.data![0].signedUrl!, undefined, { external: true })).status, 200);
  });
});

describe("reset", () => {
  test("Reset demo data restores the original records and files", async () => {
    assert.ok(((await owner.from("talent").select("id", { count: "exact", head: true })).count ?? 0) > 0);
    await owner.from("companies").delete().eq("id", "c0000000-0000-4000-8000-000000000002");
    const before = await getSandbox();
    await resetSandbox();
    const current = await getSandbox();
    assert.notEqual(current.db, before.db);
    assert.equal(current.resets, 1);

    // The same signed-in session keeps working: seeded accounts keep their ids.
    assert.equal((await owner.from("companies").select("id", { count: "exact", head: true })).count, 2);
    assert.equal((await owner.from("talent").select("id", { count: "exact", head: true })).count, 0);
    assert.equal((await owner.from("agency_members").select("id", { count: "exact", head: true })).count, 7);
    assert.equal(current.files.size, 0);
    const created = await owner.from("companies").insert({ name: "After Reset" }).select("id").single();
    assert.equal(created.error, null, "the restored sandbox accepts writes");
  });
});

test("nothing left the process", () => {
  assert.deepEqual(outbound, []);
});
