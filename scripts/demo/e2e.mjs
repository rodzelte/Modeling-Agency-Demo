// End-to-end check of a running demo: every module is exercised through the
// app's own pages and API routes (create, read, update, delete), then the demo
// is reset and compared with its starting state.
//
//   npm run demo                      (in one terminal)
//   node scripts/demo/e2e.mjs         (in another; BASE_URL=... for a deployed demo)
//
// It refuses to run against anything that is not in demo mode.
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/+$/, "");
const results = [];
let section = "";

function record(ok, name, detail = "") {
  results.push({ ok, section, name, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
}
function check(condition, name, detail = "") {
  record(Boolean(condition), name, condition ? "" : detail);
  return Boolean(condition);
}
function begin(title) {
  section = title;
  console.log(`\n${title}`);
}

// A browser-like session: keeps the cookies the app sets.
class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "); }
  async request(path, { method = "GET", body, redirect = "manual", headers = {} } = {}) {
    const response = await fetch(`${BASE}${path}`, {
      method, redirect,
      headers: { ...(this.cookies.size ? { cookie: this.header() } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), origin: BASE, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === "" || /max-age=0/i.test(cookie)) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    return response;
  }
  async json(path, options) {
    const response = await this.request(path, options);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
    return { status: response.status, ok: response.ok, data };
  }
  async page(path) {
    let response = await this.request(path);
    let hops = 0;
    while ([301, 302, 303, 307, 308].includes(response.status) && hops < 5) {
      const location = response.headers.get("location");
      response = await this.request(new URL(location, BASE).pathname + new URL(location, BASE).search);
      hops += 1;
    }
    const html = await response.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    return { status: response.status, html, text, url: response.url };
  }
  async signIn(account) {
    this.cookies.clear();
    const result = await this.json("/api/demo/login", { method: "POST", body: { account } });
    if (!result.ok) throw new Error(`demo sign-in as ${account} failed: ${JSON.stringify(result.data)}`);
    return result.data;
  }
}

// Direct sandbox reads/uploads as a signed-in demo user, through the same bridge the browser uses.
async function sandboxClient(email, password) {
  const client = createClient(`${BASE}/api/demo/supabase`, "demo-anon-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sandbox sign-in failed: ${error.message}`);
  return client;
}

const BROKEN = /Application error|Something went wrong|Unhandled Runtime Error|This page could not be found|is not approved for the agency dashboard|You do not have access/i;
const expectStatus = (result, status, name) => check(result.status === status, name, `expected ${status}, got ${result.status} ${JSON.stringify(result.data ?? "").slice(0, 160)}`);

const TABLES = ["talent", "talent_photos", "companies", "company_contacts", "bookings", "booking_talent", "tasks", "packages", "applications", "website_pages", "website_redirects", "boards", "agency_members", "talent_addresses", "talent_notes", "ghl_contacts"];
async function counts(db) {
  const entries = await Promise.all(TABLES.map(async (table) => [table, (await db.from(table).select("*", { count: "exact", head: true })).count]));
  return Object.fromEntries(entries);
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const soon = (days, hour) => { const date = new Date(Date.now() + days * 86400000); date.setHours(hour, 0, 0, 0); return date.toISOString(); };

async function main() {
  console.log(`Demo end-to-end check against ${BASE}`);

  // -------------------------------------------------------------------------
  begin("1. Isolation");
  const status = await (await fetch(`${BASE}/api/demo/status`)).json().catch(() => null);
  if (status?.mode !== "demo") {
    console.error("\nThis server is not running in demo mode. Refusing to continue.");
    process.exit(2);
  }
  check(status.supabaseProject === null, "no Supabase project is configured");
  check(status.productionSettingsPresent.length === 0, "no real-service settings are present in the server process", status.productionSettingsPresent.join(", "));
  check((await fetch(`${BASE}/api/integrations/ghl`, { method: "POST", body: "{}" })).status === 404, "inbound GHL webhook is switched off");
  check((await fetch(`${BASE}/api/integrations/ghl/events`, { method: "POST", body: "{}" })).status === 404, "inbound GHL events webhook is switched off");
  check((await fetch(`${BASE}/api/integrations/ghl/sync`, { method: "POST" })).status === 404, "scheduled GHL sync endpoint is switched off");
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check(/Disallow: \/\s*$/m.test(robots), "search engines are told not to index the demo");

  const owner = new Session();
  const account = await owner.signIn("owner");
  check(account.redirect === "/dashboard", "one-click sign-in as the sample owner");
  // Share links must work behind a proxy: redirects stay on the visitor's address.
  const shareLink = await new Session().request("/demo?as=booker");
  check(shareLink.status === 303 && shareLink.headers.get("location") === "/dashboard" && shareLink.headers.getSetCookie().length > 0, "the share link /demo signs in and redirects on the visitor's own address", `${shareLink.status} ${shareLink.headers.get("location")}`);
  const portalLink = await new Session().request("/demo?as=talent");
  check(portalLink.headers.get("location") === "/portal", "/demo?as=talent opens the portal", String(portalLink.headers.get("location")));
  check((await new Session().request("/join")).headers.get("location") === "/demo/join", "/join redirects on the visitor's own address");
  const accounts = await import("../../src/demo/accounts.ts");
  const db = await sandboxClient(accounts.demoAccount("owner").email, accounts.DEMO_PASSWORD);
  const baseline = await counts(db);
  check(baseline.talent >= 15 && baseline.bookings >= 5 && baseline.companies >= 5, "the sandbox starts with sample data", JSON.stringify(baseline));

  // -------------------------------------------------------------------------
  begin("2. Public website (anonymous visitor)");
  const visitor = new Session();
  for (const path of ["/", "/models", "/sitemap.xml"]) {
    const page = await visitor.page(path);
    check(page.status === 200 && !BROKEN.test(page.text), `GET ${path}`, `status ${page.status}`);
  }
  const { data: publicTalents } = await createClient(`${BASE}/api/demo/supabase`, "demo-anon-key", { auth: { persistSession: false } }).from("public_talents_view").select("slug,name:display_name,primary_image_path").limit(40);
  check((publicTalents ?? []).length >= 10, "published talent are visible to anonymous visitors", `${publicTalents?.length ?? 0} found`);
  const sample = (publicTalents ?? []).find((talent) => talent.primary_image_path) ?? publicTalents?.[0];
  if (sample) {
    const profile = await visitor.page(`/models/${sample.slug}`);
    check(profile.status === 200 && profile.text.includes(sample.name), `public profile /models/${sample.slug}`, `status ${profile.status}`);
    // Photos are rendered through the image optimizer: /_next/image?url=<encoded sandbox path>&w=..&q=..
    const optimized = /\/_next\/image\?url=(%2Fapi%2Fdemo%2Fsupabase%2Fstorage%2Fv1%2Fobject%2Fpublic%2Ftalent-public%2F[^&"'\s]+)&(?:amp;)?w=(\d+)&(?:amp;)?q=(\d+)/.exec(profile.html);
    if (check(Boolean(optimized), "the profile shows images served by the sandbox")) {
      const file = await fetch(`${BASE}${decodeURIComponent(optimized[1])}`);
      check(file.status === 200 && (file.headers.get("content-type") ?? "").startsWith("image/"), "a public photo downloads", `status ${file.status}`);
      const resized = await fetch(`${BASE}/_next/image?url=${optimized[1]}&w=${optimized[2]}&q=${optimized[3]}`);
      check(resized.status === 200 && (resized.headers.get("content-type") ?? "").startsWith("image/"), "the image optimizer serves it", `status ${resized.status}`);
    }
  }
  const anon = createClient(`${BASE}/api/demo/supabase`, "demo-anon-key", { auth: { persistSession: false } });
  check(((await anon.from("talent_private_details").select("talent_id")).data ?? []).length === 0, "anonymous visitors cannot read private details");
  check(((await anon.from("bookings").select("id")).data ?? []).length === 0, "anonymous visitors cannot read bookings");
  const join = await visitor.page("/join");
  check(join.status === 200 && /simulated/i.test(join.text), "“Join us” stays inside the demo (no real application form)");

  // -------------------------------------------------------------------------
  begin("3. Dashboard pages (owner)");
  const pages = ["/dashboard", "/dashboard/talent", "/dashboard/talent/new", "/dashboard/applications", "/dashboard/requests", "/dashboard/boards", "/dashboard/search?q=a",
    "/dashboard/bookings", "/dashboard/bookings/new", "/dashboard/calendar", "/dashboard/tasks", "/dashboard/companies", "/dashboard/contacts", "/dashboard/packages",
    "/dashboard/finance", "/dashboard/memberships", "/dashboard/website", "/dashboard/ghl", "/dashboard/ghl/contacts", "/dashboard/ghl/mapping", "/dashboard/cds",
    "/dashboard/settings", "/dashboard/profile"];
  for (const path of pages) {
    const page = await owner.page(path);
    check(page.status === 200 && !BROKEN.test(page.text), `GET ${path}`, `status ${page.status} ${BROKEN.exec(page.text)?.[0] ?? ""}`);
  }
  const { data: heroTalent } = await db.from("talent").select("id,display_name,slug").eq("publication_status", "published").order("display_name").limit(1).single();
  for (const tab of ["", "?tab=media", "?tab=private", "?tab=legal", "?tab=banking", "?tab=documents", "?tab=crm"]) {
    const page = await owner.page(`/dashboard/talent/${heroTalent.id}${tab}`);
    check(page.status === 200 && page.text.includes(heroTalent.display_name) && !BROKEN.test(page.text), `talent record ${tab || "(overview)"}`, `status ${page.status}`);
  }
  const { data: anyBooking } = await db.from("bookings").select("id").limit(1).single();
  const { data: anyCompany } = await db.from("companies").select("id").limit(1).single();
  const { data: anyApplication } = await db.from("applications").select("id").limit(1).maybeSingle();
  const { data: anyPackage } = await db.from("packages").select("id").limit(1).maybeSingle();
  const { data: anyPage } = await db.from("website_pages").select("id").limit(1).single();
  for (const path of [`/dashboard/bookings/${anyBooking.id}`, `/dashboard/companies/${anyCompany.id}`, ...(anyApplication ? [`/dashboard/applications/${anyApplication.id}`] : []),
    ...(anyPackage ? [`/dashboard/packages/${anyPackage.id}`] : []), `/dashboard/website/pages/${anyPage.id}`, `/preview/talent/${heroTalent.id}`, `/dashboard/talent/${heroTalent.id}/comp-card`]) {
    const page = await owner.page(path);
    check(page.status === 200 && !BROKEN.test(page.text), `GET ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, ":id")}`, `status ${page.status}`);
  }

  // -------------------------------------------------------------------------
  begin("4. Companies and contacts — create, read, update, delete");
  const company = await owner.json("/api/dashboard/companies", { method: "POST", body: { name: "E2E Atelier Verano", kind: "brand", city: "Houston", email: "studio@verano-demo.example" } });
  expectStatus(company, 201, "create a company");
  const companyId = company.data?.id;
  check((await owner.page("/dashboard/companies?q=E2E")).text.includes("E2E Atelier Verano"), "the new company appears in the list");
  expectStatus(await owner.json(`/api/dashboard/companies/${companyId}`, { method: "PATCH", body: { name: "E2E Atelier Verano", kind: "brand", city: "San Antonio", notes: "Prefers morning call times" } }), 200, "edit the company");
  check((await db.from("companies").select("city").eq("id", companyId).single()).data?.city === "San Antonio", "the edit is stored");
  const contact = await owner.json(`/api/dashboard/companies/${companyId}/contacts`, { method: "POST", body: { name: "Lucia Verano", title: "Creative director", email: "lucia@verano-demo.example", is_primary: true } });
  expectStatus(contact, 201, "add a contact");
  expectStatus(await owner.json(`/api/dashboard/contacts/${contact.data?.id}`, { method: "PATCH", body: { name: "Lucia Verano", title: "Head of creative" } }), 200, "edit the contact");
  check((await owner.page(`/dashboard/companies/${companyId}`)).text.includes("Head of creative"), "the company page shows the edited contact");
  check((await owner.json(`/api/dashboard/contacts/${contact.data?.id}`, { method: "DELETE" })).ok, "delete the contact");

  // -------------------------------------------------------------------------
  begin("5. Talent — create, edit, records, boards, media, publish");
  const { data: boards } = await db.from("boards").select("id,slug,path_segment,parent_board_id").eq("publish_to_website", true).eq("internal_only", false).eq("is_active", true).order("sort_order");
  const board = boards.find((candidate) => candidate.parent_board_id) ?? boards[0];
  const created = await owner.json("/api/dashboard/talents", { method: "POST", body: { first_name: "Noor", last_name: "Hadley", gender: "Female", location: "Dallas, TX", date_of_birth: "2001-03-14", board_ids: [board.id] } });
  expectStatus(created, 201, "create a talent (draft)");
  const talentId = created.data?.id;
  const talentSlug = created.data?.slug;
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}`, { method: "PATCH", body: { core: { public_bio: "Editorial and runway. Sample record created by the end-to-end check.", show_measurements: true }, private: { mobile: "555-0142", email: "noor.hadley@talent-demo.example" } } }), 200, "edit profile and private details");
  check((await db.from("talent_private_details").select("mobile").eq("talent_id", talentId).single()).data?.mobile === "555-0142", "private details are stored");
  const address = await owner.json(`/api/dashboard/talents/${talentId}/records/addresses`, { method: "POST", body: { label: "Home", address_1: "1420 Alder Court", city: "Dallas", state: "TX", postal_code: "75201", country: "USA", is_main: true } });
  expectStatus(address, 201, "add an address record");
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}/records/addresses/${address.data?.id}`, { method: "PATCH", body: { city: "Plano" } }), 200, "edit the address record");
  check((await owner.json(`/api/dashboard/talents/${talentId}/records/addresses/${address.data?.id}`, { method: "DELETE" })).ok, "delete the address record");
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}/records/notes`, { method: "POST", body: { note_type: "internal", body: "Strong test shoot. Follow up about runway availability." } }), 201, "add a note");
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}/records/social`, { method: "POST", body: { platform: "Instagram", handle: "noor.hadley.demo", follower_count: 18400 } }), 201, "add a social account");
  const measurement = await owner.json(`/api/dashboard/talents/${talentId}/records/measurements`, { method: "POST", body: { measured_on: new Date().toISOString().slice(0, 10), height_cm: 177, bust_chest_cm: 82, waist_cm: 61, hips_cm: 89, shoe_size_us: "8.5", hair_color: "Brown", eye_color: "Hazel" } });
  check(measurement.status === 201 || measurement.status === 200, "add measurements", `status ${measurement.status} ${JSON.stringify(measurement.data)}`);
  const secondBoard = boards.find((candidate) => candidate.id !== board.id);
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}/boards`, { method: "POST", body: { board_id: secondBoard.id } }), 200, "assign a second board");
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}/boards`, { method: "DELETE", body: { board_id: secondBoard.id } }), 200, "remove the second board");

  const photoPath = `talent/${talentId}/e2e-${Date.now()}.png`;
  const upload = await db.storage.from("talent-private").upload(photoPath, new Blob([png], { type: "image/png" }), { contentType: "image/png" });
  check(!upload.error, "upload a photo to private storage", upload.error?.message);
  const photo = await owner.json(`/api/dashboard/talents/${talentId}/media`, { method: "POST", body: { storage_path: photoPath, title: "Test shot", alt_text: "Noor Hadley, studio portrait", mime_type: "image/png", file_size: png.length } });
  expectStatus(photo, 201, "register the photo");
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}/media/${photo.data?.id}`, { method: "PATCH", body: { public: true } }), 200, "make the photo public (copy to public storage)");
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}/media/featured`, { method: "POST", body: { photo_id: photo.data?.id } }), 200, "set it as the primary image");
  const stored = (await db.from("talent_photos").select("public,public_storage_path,featured").eq("id", photo.data?.id).single()).data;
  check(stored?.public && stored.public_storage_path, "the photo has a public copy");

  check((await visitor.page(`/models/${talentSlug}`)).status === 404, "a draft talent is not on the public website");
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}/publication`, { method: "POST", body: { action: "publish" } }), 200, "publish the talent");
  const live = await visitor.page(`/models/${talentSlug}`);
  check(live.status === 200 && live.text.includes("Noor"), "the published talent appears on the public website", `status ${live.status}`);
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}/publication`, { method: "POST", body: { action: "unpublish" } }), 200, "unpublish the talent");
  check((await visitor.page(`/models/${talentSlug}`)).status === 404, "the unpublished talent is gone from the public website");
  expectStatus(await owner.json(`/api/dashboard/talents/${talentId}/publication`, { method: "POST", body: { action: "archive" } }), 200, "archive the talent");
  const card = await owner.request(`/api/dashboard/talents/${heroTalent.id}/comp-card`);
  check(card.status === 200 && card.headers.get("content-type") === "application/pdf" && Buffer.from(await card.arrayBuffer()).subarray(0, 4).toString() === "%PDF", "PDF comp card is generated from the sample photos", `status ${card.status}`);
  const { data: document } = await db.from("talent_documents").select("id,talent_id").limit(1).single();
  const download = await owner.request(`/api/dashboard/talents/${document.talent_id}/documents/${document.id}/download`);
  const signedPath = download.headers.get("location") ?? "";
  const signedLink = new URL(signedPath, BASE).href;
  check([302, 307].includes(download.status) && signedPath.startsWith("/api/demo/supabase/storage/v1/object/sign/talent-documents/"), "a private document download is redirected to a short-lived signed link", `status ${download.status} ${signedLink.slice(0, 80)}`);
  const documentFile = await fetch(signedLink);
  check(documentFile.status === 200 && documentFile.headers.get("content-type") === "application/pdf", "the signed link serves the document", `status ${documentFile.status}`);
  check((await fetch(signedLink.replace(/token=[^&]+/, "token=forged"))).status !== 200, "a forged link is refused");
  const csv = await owner.request("/api/dashboard/talents/export");
  check(csv.status === 200 && (await csv.text()).includes("Noor"), "roster CSV export includes the new talent");

  // -------------------------------------------------------------------------
  begin("6. Bookings, money and tasks");
  const booking = await owner.json("/api/dashboard/bookings", { method: "POST", body: { title: "E2E spring lookbook", booking_type: "shoot", status: "option", company_id: companyId, start_at: soon(9, 9), end_at: soon(9, 17), location: "Studio 4, Design District", talent_ids: [heroTalent.id] } });
  expectStatus(booking, 201, "create a booking with talent");
  const bookingId = booking.data?.id;
  const clash = await owner.json("/api/dashboard/bookings/conflicts", { method: "POST", body: { talent_ids: [heroTalent.id], start_at: soon(9, 10), end_at: soon(9, 12) } });
  check(clash.ok && JSON.stringify(clash.data).includes("E2E spring lookbook"), "the double-booking check finds it", JSON.stringify(clash.data).slice(0, 200));
  expectStatus(await owner.json(`/api/dashboard/bookings/${bookingId}`, { method: "PATCH", body: { title: "E2E spring lookbook", status: "confirmed", start_at: soon(9, 9), end_at: soon(9, 18), talent_ids: [heroTalent.id] } }), 200, "confirm and extend the booking");
  expectStatus(await owner.json(`/api/dashboard/bookings/${bookingId}/financials`, { method: "PUT", body: { rate_type: "day", fee_total: 2400, currency: "USD", commission_pct: 20, invoice_status: "invoiced", invoice_number: "E2E-1001", talent_fees: [{ talent_id: heroTalent.id, fee: 1920 }] } }), 200, "save fees and invoice details");
  check((await owner.page(`/dashboard/bookings/${bookingId}`)).html.includes("E2E-1001"), "the booking page shows the invoice number");
  check((await owner.page("/dashboard/finance")).text.includes("E2E spring lookbook"), "the booking appears in Finance");
  const ics = await owner.request(`/api/dashboard/calendar/ics?booking=${bookingId}`);
  check(ics.status === 200 && (await ics.text()).includes("E2E spring lookbook"), "calendar (.ics) export of the booking");
  const schedule = await owner.request(`/api/dashboard/calendar/ics?talent=${heroTalent.id}`);
  check(schedule.status === 200 && (await schedule.text()).includes("E2E spring lookbook"), "calendar (.ics) export of the talent's schedule includes it");
  const finance = await owner.request("/api/dashboard/finance/export");
  check(finance.status === 200 && (await finance.text()).includes("E2E-1001"), "finance CSV export includes it");
  const task = await owner.json("/api/dashboard/tasks", { method: "POST", body: { title: "E2E send call sheet", priority: "high", related_type: "booking", related_id: bookingId } });
  expectStatus(task, 201, "create a task");
  expectStatus(await owner.json(`/api/dashboard/tasks/${task.data?.id}`, { method: "PATCH", body: { status: "done" } }), 200, "complete the task");
  check((await owner.json(`/api/dashboard/tasks/${task.data?.id}`, { method: "DELETE" })).ok, "delete the task");
  check((await owner.json(`/api/dashboard/bookings/${bookingId}`, { method: "DELETE" })).ok, "delete the booking");
  check((await db.from("bookings").select("id").eq("id", bookingId).maybeSingle()).data === null, "the booking is gone");

  // -------------------------------------------------------------------------
  begin("7. Packages (client links)");
  const pack = await owner.json("/api/dashboard/packages", { method: "POST", body: { title: "E2E Verano shortlist", talent_ids: [heroTalent.id] } });
  expectStatus(pack, 201, "create a package");
  expectStatus(await owner.json(`/api/dashboard/packages/${pack.data?.id}`, { method: "PUT", body: { title: "E2E Verano shortlist", message: "Our picks for the spring campaign.", company_id: companyId, show_measurements: true, items: [{ talent_id: heroTalent.id, note: "First option" }] } }), 200, "edit the package");
  const share = await owner.json(`/api/dashboard/packages/${pack.data?.id}/share`, { method: "POST", body: { days: 14 } });
  check(share.ok && share.data?.url, "create a client link");
  check(share.data?.url?.startsWith(`${BASE}/p/`), "the client link uses the address the visitor is on", String(share.data?.url));
  const sharePath = share.data?.url ? new URL(share.data.url).pathname : "/p/missing";
  const shared = await visitor.page(sharePath);
  check(shared.status === 200 && shared.text.includes("E2E Verano shortlist"), "the client link opens without signing in", `status ${shared.status}`);
  check((await owner.json(`/api/dashboard/packages/${pack.data?.id}/share`, { method: "DELETE" })).ok, "revoke the link");
  check(!(await visitor.page(sharePath)).text.includes("Our picks for the spring campaign."), "the revoked link no longer shows the package");
  check((await owner.json(`/api/dashboard/packages/${pack.data?.id}`, { method: "DELETE" })).ok, "delete the package");
  check((await owner.json(`/api/dashboard/companies/${companyId}`, { method: "DELETE" })).ok, "delete the company");

  // -------------------------------------------------------------------------
  begin("8. Website (CMS)");
  const page = await owner.json("/api/dashboard/website/pages", { method: "POST", body: { title: "E2E Press", slug: "e2e-press" } });
  expectStatus(page, 201, "create a page");
  check((await visitor.page("/e2e-press")).status === 404, "a draft page is not public");
  expectStatus(await owner.json(`/api/dashboard/website/pages/${page.data?.id}/publish`, { method: "POST" }), 200, "publish the page");
  const pressPage = await visitor.page("/e2e-press");
  check(pressPage.status === 200 && pressPage.text.includes("E2E Press"), "the published page is public", `status ${pressPage.status}`);
  expectStatus(await owner.json(`/api/dashboard/website/pages/${page.data?.id}/unpublish`, { method: "POST" }), 200, "unpublish the page");
  check((await owner.json(`/api/dashboard/website/pages/${page.data?.id}`, { method: "DELETE" })).ok, "delete the page");
  expectStatus(await owner.json("/api/dashboard/website/redirects", { method: "POST", body: { from_path: "/e2e-old", to_path: "/models", permanent: false } }), 201, "add a redirect");
  const hop = await visitor.request("/e2e-old");
  check([301, 302, 307, 308].includes(hop.status) && (hop.headers.get("location") ?? "").endsWith("/models"), "the redirect works on the public site", `status ${hop.status}`);
  const redirect = (await db.from("website_redirects").select("id").eq("from_path", "/e2e-old").single()).data;
  check((await owner.json(`/api/dashboard/website/redirects/${redirect?.id}`, { method: "DELETE" })).ok, "delete the redirect");

  // -------------------------------------------------------------------------
  begin("9. Applications");
  const { data: application } = await db.from("applications").select("id,status,first_name").in("status", ["new", "reviewing"]).limit(1).maybeSingle();
  if (!check(Boolean(application), "a sample application is waiting for review")) throw new Error("no sample application to work with");
  expectStatus(await owner.json(`/api/dashboard/applications/${application.id}/notes`, { method: "POST", body: { body: "E2E: strong digitals, book a video call." } }), 201, "add a review note");
  expectStatus(await owner.json(`/api/dashboard/applications/${application.id}`, { method: "PATCH", body: { status: "approved" } }), 200, "approve the application");
  const converted = await owner.json(`/api/dashboard/applications/${application.id}/convert`, { method: "POST", body: {} });
  check(converted.ok, "convert the application into a draft talent", `status ${converted.status} ${JSON.stringify(converted.data)}`);
  check((await db.from("applications").select("status").eq("id", application.id).single()).data?.status === "converted", "the application is marked converted");

  // -------------------------------------------------------------------------
  begin("10. Team, permissions and memberships");
  const member = await owner.json("/api/dashboard/team", { method: "POST", body: { email: "e2e.teammate@northlight-demo.example", fullName: "Eve Teammate", role: "booker", status: "active", password: "temporary-pass-1" } });
  check(member.status === 201 && member.data?.confirmation_sent !== undefined, "add a teammate with a temporary password (the confirmation email is simulated)", `status ${member.status} ${JSON.stringify(member.data)}`);
  const teammate = await sandboxClient("e2e.teammate@northlight-demo.example", "temporary-pass-1").catch((error) => error);
  check(!(teammate instanceof Error), "the new teammate can sign in", teammate instanceof Error ? teammate.message : "");
  expectStatus(await owner.json("/api/dashboard/permissions", { method: "POST", body: { role: "read_only", permission: "operations.manage", granted: true } }), 200, "grant a permission to a role");
  expectStatus(await owner.json("/api/dashboard/permissions", { method: "POST", body: { role: "read_only", permission: "operations.manage", granted: false } }), 200, "take it away again");
  check((await owner.request(`/api/dashboard/team?id=${member.data?.id}`, { method: "DELETE" })).status === 204, "remove the teammate");
  const plan = (await db.from("subscription_plans").select("key").limit(1).single()).data;
  expectStatus(await owner.json("/api/dashboard/memberships", { method: "POST", body: { action: "grant", talent_id: heroTalent.id, plan_key: plan.key, note: "E2E complimentary access" } }), 200, "grant a membership");
  expectStatus(await owner.json("/api/dashboard/memberships", { method: "POST", body: { action: "end", talent_id: heroTalent.id } }), 200, "end the membership");

  // -------------------------------------------------------------------------
  begin("11. Integrations are simulated");
  const sync = await owner.json("/api/dashboard/ghl", { method: "POST", body: { action: "reconcile" } });
  check(sync.ok, "“Run sync now” completes against the simulated CRM", `status ${sync.status} ${JSON.stringify(sync.data)}`);
  const lastRun = (await db.from("ghl_sync_runs").select("status,trigger").order("started_at", { ascending: false }).limit(1).single()).data;
  check(lastRun?.trigger === "dashboard" && lastRun.status !== "failed", "the sync run is recorded", JSON.stringify(lastRun));

  // -------------------------------------------------------------------------
  begin("12. Roles are enforced");
  const viewer = new Session();
  await viewer.signIn("read_only");
  check((await viewer.page("/dashboard/talent")).status === 200, "read-only can open the talent list");
  check((await viewer.json("/api/dashboard/companies", { method: "POST", body: { name: "Should Not Exist" } })).status === 403, "read-only cannot create a company");
  check((await viewer.json(`/api/dashboard/talents/${heroTalent.id}/publication`, { method: "POST", body: { action: "unpublish" } })).status === 403, "read-only cannot unpublish talent");
  const stranger = new Session();
  check((await stranger.json("/api/dashboard/companies", { method: "POST", body: { name: "Should Not Exist" } })).status === 401, "signed-out requests are rejected");
  check([302, 303, 307].includes((await stranger.request("/dashboard")).status), "signed-out visitors are sent to sign-in");

  // -------------------------------------------------------------------------
  begin("13. Talent portal");
  const talent = new Session();
  const portal = await talent.signIn("talent");
  check(portal.redirect === "/portal", "one-click sign-in as the sample talent");
  for (const path of ["/portal", "/portal/profile", "/portal/digitals", "/portal/availability", "/portal/bookings", "/portal/documents"]) {
    const page = await talent.page(path);
    check(page.status === 200 && !BROKEN.test(page.text), `GET ${path}`, `status ${page.status}`);
  }
  const away = await talent.json("/api/portal/availability", { method: "POST", body: { start_on: soon(20, 0).slice(0, 10), end_on: soon(23, 0).slice(0, 10), kind: "unavailable", note: "E2E family trip" } });
  check(away.ok, "the talent adds an availability entry", `status ${away.status} ${JSON.stringify(away.data)}`);
  const ask = await talent.json("/api/portal/requests", { method: "POST", body: { field_group: "contact", changes: { mobile: "555-0188" }, message: "E2E: new phone number" } });
  check(ask.ok, "the talent asks for a contact change", `status ${ask.status} ${JSON.stringify(ask.data)}`);
  const talentAccount = accounts.demoAccount("talent");
  const { data: talentMember } = await db.from("agency_members").select("talent_id").eq("user_id", talentAccount.id).single();
  const { data: pendingRequest } = await db.from("talent_change_requests").select("id").eq("talent_id", talentMember.talent_id).eq("status", "pending").eq("message", "E2E: new phone number").maybeSingle();
  check(Boolean(pendingRequest), "staff see the request in the review queue");
  check((await db.from("talent_private_details").select("mobile").eq("talent_id", talentMember.talent_id).single()).data?.mobile !== "555-0188", "nothing changes until staff approve");
  const review = await owner.json(`/api/dashboard/change-requests/${pendingRequest?.id}`, { method: "POST", body: { approve: true, note: "Updated, thank you." } });
  check(review.ok, "staff approve the request", `status ${review.status} ${JSON.stringify(review.data)}`);
  check((await db.from("talent_private_details").select("mobile").eq("talent_id", talentMember.talent_id).single()).data?.mobile === "555-0188", "the approved change is applied to the talent record");
  check([302, 303, 307].includes((await talent.request("/dashboard")).status), "a talent login cannot open the staff dashboard");

  // -------------------------------------------------------------------------
  begin("14. Reset demo data");
  const changed = await counts(db);
  check(changed.talent > baseline.talent && changed.agency_members === baseline.agency_members, "the demo now differs from its starting state", JSON.stringify(changed));
  check((await owner.json("/api/demo/reset", { method: "POST" })).status === 403, "a reset request that does not come from the demo's own page is refused");
  const reset = await owner.json("/api/demo/reset", { method: "POST", headers: { "x-demo-reset": "1" } });
  check(reset.ok, "Reset demo data", JSON.stringify(reset.data));
  const after = await counts(await sandboxClient(accounts.demoAccount("owner").email, accounts.DEMO_PASSWORD));
  check(JSON.stringify(after) === JSON.stringify(baseline), "every table is back to its starting row count", `before ${JSON.stringify(baseline)} after ${JSON.stringify(after)}`);
  check((await owner.page("/dashboard")).status === 200, "the owner session still works after the reset");
  check((await visitor.page("/e2e-press")).status === 404 && (await visitor.page(`/models/${talentSlug}`)).status === 404, "records created during the demo are gone from the public site");

  // -------------------------------------------------------------------------
  begin("15. Nothing left the server");
  const final = await (await fetch(`${BASE}/api/demo/status`)).json();
  const hosts = [...new Set(final.outboundRequestsBlocked.map((entry) => entry.host))];
  const framework = new Set(["telemetry.nextjs.org", "registry.npmjs.org"]);
  check(hosts.every((host) => framework.has(host)), "the application attempted no outbound requests", hosts.join(", "));
  if (hosts.length) console.log(`    (refused framework housekeeping: ${hosts.join(", ")})`);
  check(final.productionSettingsPresent.length === 0, "still no real-service settings in the process");
}

main().catch((error) => {
  record(false, "the check ran to the end", error instanceof Error ? error.stack ?? error.message : String(error));
}).finally(() => {
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  for (const failure of failed) console.log(`  ✗ [${failure.section}] ${failure.name}${failure.detail ? ` — ${failure.detail}` : ""}`);
  process.exit(failed.length ? 1 : 0);
});
