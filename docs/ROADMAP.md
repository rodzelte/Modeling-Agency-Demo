# Production roadmap — 42 Model Management

_Written 2026-09-30 from a review of the codebase at `bc0ddf7`, the production Supabase project (migrations 001–018), the test suite (94/94 passing), and spec sections 1–72 of `42_Agency_OS_Claude_Master_Prompt.md`._

> **Status (2026-10-01):** Phases 9–17 are built, tested and **live**.
> - All of Phases 0–17 are on `main` and deployed on Vercel.
> - Migrations 001–025 are applied to Supabase. See `HANDOFF.md` and `launch-checklist.md`.
> - Adaptations made on the owner's instructions:
>   - There is no staging project (single Supabase project; `staging.md`).
>   - Join Us stays on GoHighLevel, with a webhook and import (`ghl-integration.md`) replacing the native form.

**Answer: 9 more phases (9–17) are needed to reach a fully production-ready system.**

- **One of them is new, Phase 9 (Release Foundation).** The spec assumes staging, CI and browser testing exist, and they don't yet. Every later phase depends on them.
- **The other eight map to spec Phases 9–16.** Related work is merged where it belongs together:
  - public forms share one anti-abuse layer;
  - brand and content fixes live with the CMS;
  - the leftover Phase 7 hardening sits in Phase 9.

| Roadmap phase | Name | Spec phase(s) | Relative size |
|---|---|---|---|
| 9 | Release foundation and Phase 1–8 sign-off | 57–60, 7 hardening, 43 | M |
| 10 | Public discovery, search and site performance | 9, §34, §46 | M |
| 11 | Applications, inquiries and public forms | 10, §35, §42 | L |
| 12 | CMS, website content and brand completion | 11, §31, §36–38, §47 | L |
| 13 | Agency operations: clients, bookings, calendar, tasks | 12, §22–23, §39–40 | L |
| 14 | Comp cards, packages and client sharing | 13, §30 | M |
| 15 | Talent portal | 14, §41 | M |
| 16 | Security hardening | 15, §44 | M |
| 17 | QA, release candidate and production launch | 16, §62–65 | M |

- **Sizes are relative.** S is a few days, M is one to two weeks, and L is two to four weeks, for one developer working with this codebase. Staging QA and owner review come on top.
- **Order:** the phases run in this order. Phases 13–15 could be reordered if the business needs operations or the talent portal sooner. Phase 9 must come first, and Phases 16–17 must come last.

---

## Part 1 — Already completed (do not rebuild)

Verified in the code and in production. Details are in `HANDOFF.md`, `architecture.md`, `database.md` and `permissions.md`.

### Database and security (migrations 001–018, all applied to production)

- **Role authority:**
  - `agency_members` is the only role authority. It is bound to `auth.uid()`, and binding requires a confirmed email.
  - `profiles` and `profile_roles` are read-only mirrors.
  - The last owner is protected.
- **Permissions:** the data-driven permission matrix (`permissions`, `role_permissions`, `has_permission()`, `current_permissions()`), with RLS on every table built on it.
- **Talent logins:** the foundation exists at database level: the `talent` role, `agency_members.talent_id` and `current_talent_id()`, plus own-record policies.
- **Private data:**
  - Private talent fields live in `talent_private_details`. The old columns on `talent` are withdrawn from the API by column grants.
  - A publish/archive permission trigger enforces who may publish or archive.
- **Audit:**
  - `audit_logs` is written only by triggers and `write_audit()`.
  - Membership, publication and board changes are audited.
  - Legal, banking and medical changes are audited without storing values.
  - Sensitive views and document downloads are logged.
- **Public views:** all are `security_invoker`, with anon-only policies and column grants. There is no DOB, contact or private data. Age and measurements are opt-in.
  - `public_boards_view`
  - `public_talents_view`
  - `public_talent_media_view`
  - `public_talent_portfolios_view`
  - `public_talent_skills_view`
- **Storage:** six buckets with size and MIME limits and no anonymous listing. Media is private-first, and "Make public" copies files.
- **Supabase advisor:** 0 errors. The remaining warnings are deliberate (listed in `security-review.md`).

### Dashboard (Phases 2–7)

- **Access:** server-enforced routes (`requirePage`/`requireApi`) and navigation that follows the viewer's permissions.
- **UI kit:** a shared kit, plus loading, empty, error and unauthorized states.
- **Talent:**
  - Paginated, filterable list; create; archive and restore; publish and unpublish.
  - The 16-tab editor: General, Other, Legal, Addresses, Contacts, Banking, Agencies, Stats, Skills, Documents, Items, Usage, Appointments, Medical, Notes, Media.
- **Talent data:**
  - Measurement history with a current view; skill and agency catalogues; multiple phones and emails; rates.
  - Minor, guardian and consent fields.
- **Boards:** tree CRUD, reorder, publish, deactivate, and multi-board assignment.
- **Media:**
  - Photos: private upload, drag-and-drop reorder, featured photo, metadata, archive.
  - Videos (embed or file), portfolios and digital books.
- **Sensitive modules:**
  - Documents: private bucket, 60-second signed downloads, archived rather than deleted.
  - Banking: masked, with a logged reveal.
- **Overview widgets from real queries:** counts, pending review, recent updates, uploads, appointments, birthdays, and expiring contracts, passports, visas and work permits.
- **Other screens:**
  - Recent activity.
  - Global search (talent and boards).
  - Team management.
  - A read-only view of the permission matrix.
- **Preview:** a staff preview of the public profile (`/preview/talent/[id]`).

### Public site (Phase 8)

- **Pages:** home; `/models` roster with two-level board chips; board pages at `/models/<board>/<sub>`; talent profiles with media, portfolios, skills, opt-in measurements and age.
- **SEO:** real 404s for unknown paths; canonical URLs and OpenGraph metadata on profiles and boards; sitemap; robots.
- **Menu:** the site header menu is built from public boards.

### Tooling

- **Tests:** 94 automated tests on PGlite (in-memory Postgres). They replay every migration and cover RLS for each role, per-phase behaviour, public-view leakage, and the Saih acceptance workflow at database level.
- **Checks:** type check, lint and production build are clean.
- **Secrets:** env validation refuses a secret key in the public variable. There is no service-role client in the app, and no secrets are committed.

---

## Part 2 — Gaps found in the review (addressed in the phases below)

| # | Gap | Evidence | Phase |
|---|---|---|---|
| G1 | No staging project; releases went straight to production | `staging.md` | 9 |
| G2 | No CI pipeline or branch protection | No `.github/` folder | 9 |
| G3 | No browser end-to-end tests; signed-in flows never run with real Storage | Tests are database-only | 9 |
| G4 | Legacy photos from before 009 are still in `talent-public` | `security-review.md`, open item 1 | 9 |
| G5 | Old private columns still on `talent` (contract step) | `database.md` | 9 |
| G6 | Supabase settings: leaked-password protection off; `rls_auto_enable()` of unknown origin | Advisor warnings | 9 |
| G7 | No forgot/reset-password flow for email logins | `LoginForm.tsx` has sign-in only | 9 |
| G8 | Supabase's built-in mailer is heavily rate-limited and unsuitable for production | No custom SMTP configured | 9 |
| G9 | No error monitoring or alerting; errors go to server console only | No monitoring package | 9 |
| G10 | No branded `not-found.tsx` / `global-error.tsx` | Default Next.js pages | 9 |
| G11 | Login events not audited (spec §43) | No login audit | 9 |
| G12 | No security headers | `next.config.ts` has only `images` | 9 (baseline), 16 (CSP) |
| G13 | `seed.sql` is empty; spec §55 wants fictional seed data for dev/staging | `supabase/seed.sql` | 9 |
| G14 | Public pages are `force-dynamic` with no caching; `getRoster()` fetches the whole roster | `models/page.tsx`, `features/public/queries.ts` | 10 |
| G15 | Roster filters are name and board only, done on the client; no pagination | `ModelsDirectory.tsx` | 10 |
| G16 | No applications, inquiries, CMS, companies, bookings or task tables | Migration table list | 11–13 |
| G17 | No rate limiting, bot protection or HTML sanitization | None in code | 11, 12, 16 |
| G18 | Home page uses Unsplash stock photos; Privacy and Instagram links are `#` | `src/app/page.tsx` | 12 |
| G19 | Brand palette (terracotta) differs from the live brand (gold `#D5A561`/`#C08F4D`, burgundy `#9E1923`) | `discovery.md` §7 | 12 |
| G20 | No About/Contact/Join/Privacy/Terms pages; no redirects from the live site's URLs | Route list | 11, 12, 17 |
| G21 | Seven dashboard sections are placeholders: Calendar, Tasks, Companies, Contacts, Finance, Packages, Website | `nav.ts` | 12–14 |
| G22 | Permission matrix is read-only in the UI; changes need SQL | Settings page | 16 |
| G23 | No MFA for owner/admin accounts, even though they can see banking, legal and medical data | Auth config | 16 |
| G24 | Backup plan (Supabase plan / PITR), restore drill and runbooks not documented | `launch-checklist.md` | 9, 17 |

---

## Part 3 — Remaining development phases

Every phase follows the same definition of done (spec §61):

1. Migrations for all schema changes.
2. RLS reviewed.
3. Type check, lint and all automated tests pass.
4. Deployed to **staging** and QA passed.
5. Docs updated.
6. Owner approval before `main`, then `supabase db push`.

The "complete when" criteria below come on top of these.

### Phase 9 — Release foundation and Phase 1–8 sign-off

**Objective:** make every later phase safe to ship, and formally close Phases 1–8, which were validated in tests but never on staging or in a real signed-in browser.

**Depends on:** Phases 0–8 (done). **Blocks:** everything else.

**Tasks**

- **Environments:**
  - Create a staging Supabase project and apply 001–018.
  - Write `seed.sql` with fictional boards, fictional talent (including a minor) and one test user per role.
  - Point Vercel Preview at staging and add a `staging` branch.
  - Protect `main` so a green CI run is required, and stop pushing directly to production.
- **CI (GitHub Actions):** on every push and PR, run:
  - lint
  - `tsc --noEmit`
  - `npm test`, which includes the migration replay and RLS tests
  - `npm run build`
  - a secret scan (for example gitleaks)
- **Browser tests (Playwright):**
  - The Saih acceptance test (spec §51), run in a real browser against staging with real Storage.
  - A login and navigation smoke test per role.
  - Wired into CI against staging.
- **Signed-in verification:** run, on staging and then production, these flows that have only been tested at database level:
  - upload
  - Make public / withdraw
  - portfolio reorder
  - signed document download
  - banking reveal
  - board publishing
- **Close the Phase 7 leftovers (debt):**
  - **Legacy media:** a script moves pre-009 photos from `talent-public` to `talent-private`. It copies, verifies, updates the rows, then removes the public copy only for images that aren't published.
  - **Migration `019_*` (contract step):** drops the withdrawn private columns on `talent`, after a query proves every value was copied to `talent_private_details`.
- **Supabase settings:**
  - Enable leaked-password protection.
  - Review `rls_auto_enable()`, and drop it or document it.
  - Confirm email confirmation is on.
  - **Configure custom SMTP** from the agency's domain (Postmark, Resend or SES) with SPF, DKIM and DMARC.
- **Auth:**
  - A forgot-password / reset-password flow.
  - A `auth.login` audit event on sign-in (spec §43).
  - Allowlist rejections logged.
- **Observability:**
  - Error monitoring (for example Sentry) on server and client, with PII scrubbing.
  - A structured server logger in place of bare `console`.
  - An uptime check on `/` and `/models`.
- **Resilience:**
  - Branded `not-found.tsx`, `global-error.tsx` and a public error boundary.
  - Baseline security headers: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`.
- **Backups:**
  - Confirm the Supabase plan's backups and point-in-time recovery.
  - Run one restore into staging.
  - Document the procedure.

**Security / database notes:**
- Migration 019 is the project's first **destructive** migration. It needs a fresh backup, explicit owner approval, and a documented rollback (restore the columns from backup).
- Moving legacy media must never delete a file before its copy is verified.

**Complete when:**
- Staging mirrors the production schema.
- CI is required on `main`.
- The Playwright Saih test passes on staging.
- G1–G13 and G24 are closed.
- The owner signs off Phases 1–8 in `staging.md`.

**Risks if skipped:**
- Every later phase lands untested in production.
- Auth emails stop at low volume because of the default mailer's rate limit.
- Old photos stay reachable by anyone with the URL.
- Outages go unnoticed.
- There is no proven way back from bad data.

**Deliverable:**
- A staging environment.
- A CI pipeline.
- The E2E suite.
- Migration 019.
- The legacy-media script and its run log.
- Monitoring.
- A backup/restore runbook.
- The Phase 1–8 sign-off.

---

### Phase 10 — Public discovery, search and site performance

**Objective:** make the public roster searchable at scale, fast, and cache-friendly (spec Phase 9, §34, §46).

**Depends on:** 9.

**Tasks**

- **Search:**
  - Server-side search driven by URL search params, so results are shareable, bookmarkable and indexable.
  - Filters: board, portfolio, gender, age range, height, hair, eyes, waist, hips, location, skills.
  - Pagination (keyset or offset) and sort.
- **Query layer:**
  - A `search_public_talent()` function (`security invoker`) or view-based query in migration `020_*`.
  - Supporting indexes: btree on current measurements, GIN on skills and board paths, `pg_trgm` on name and location.
- **Leak-proof filters:**
  - Filter only on public-view columns, which are already `null` when `show_measurements` or `show_age` is off.
  - Otherwise, repeated filtering can reveal hidden values, for example narrowing down an exact age.
  - **Ethnicity:** filter on it only if the owner approves it as an opt-in, public-safe field. It is sensitive personal data under UK GDPR, which applies given the "USA – UK" tag.
- **Performance:**
  - Replace the full-roster fetch in `getRoster()`, and limit the home page's featured query.
  - Move public pages off `force-dynamic` to cached rendering, with on-demand revalidation when a talent, board, media order or publication changes. That keeps publishing instant while serving cached pages (check the Next 16 caching docs in `node_modules/next/dist/docs/`).
  - Right-size images through `next/image` `sizes`, lazy loading and a fixed set of image widths.
- **Favorites / "Request info" shortlist** from the live site, if the owner keeps it: a client-side shortlist here. The request-info form goes in Phase 11.
- **Dashboard search:** richer talent filters in the dashboard (spec §40), reusing the same filter builder.

**Tests:**
- Filter combinations.
- A leak test (hidden measurements and age can't be matched).
- Pagination.
- URL round-trip.
- `EXPLAIN` on a seeded roster of about 5,000 talent shows index use.

**Complete when:**
- Filters combine correctly.
- Shared URLs restore state.
- p75 LCP is under 2.5 s on mobile on staging.
- A publish change shows on the site within seconds.

**Risks if skipped:**
- Page load and Supabase egress grow with every talent added.
- Filters leak hidden attributes.
- Weak discovery and SEO.

**Deliverable:**
- The search UI and API.
- Migration 020.
- The caching and revalidation layer.
- Tests.

---

### Phase 11 — Applications, inquiries and public forms

**Objective:** replace or sync the "Join Us" funnel with a Supabase-native application pipeline, safe enough for minors and for open public traffic (spec Phase 10, §35, §42).

**Depends on:** 9 (SMTP, monitoring) and 10 (public form patterns).
**Owner decision first:** replace GoHighLevel, or keep it and sync by webhook.

**Tasks**

- **Database (migration `021_*`):**
  - Tables: `applications`, `application_photos`, `application_notes`, `inquiries`.
  - A status lifecycle: new → reviewing → info requested → approved / rejected / archived → converted.
  - New permissions: `applications.view`, `applications.manage`, `inquiries.manage`.
  - Anon gets **no** select rights.
- **Server-only admin client:**
  - The project's first service-role use: `src/lib/supabase/admin.ts`, guarded with the `server-only` import.
  - Used only to create signed upload URLs into the private `applications` bucket and to insert a submission.
  - A test proves no client bundle imports it.
- **The form:**
  - The live form's roughly 25 fields plus the three required photos: full body, headshot, 3/4.
  - A minor/guardian branch with guardian consent.
  - SMS consent with the exact wording, version and timestamp stored (TCPA).
  - A privacy-notice link.
- **Anti-abuse:**
  - Rate limiting per IP and per email.
  - Bot protection (for example Cloudflare Turnstile).
  - A honeypot field.
  - Server-side MIME, size and magic-byte checks.
  - Photos re-encoded to **strip EXIF/GPS**.
- **Email:**
  - A notification to the submissions inbox and a confirmation to the applicant.
  - A "request more info" email from the dashboard.
- **Dashboard:**
  - A review queue with filters.
  - Application detail with signed photo URLs.
  - Notes and status changes.
  - Duplicate detection by email and phone.
  - **Convert to talent:** creates a draft talent with private details and measurements, copies the photos into `talent-private`, and links back. No re-entry needed.
- **Inquiries:** Contact and "Request info" submissions go to an inquiries queue.
- **Retention:** a scheduled purge of rejected or archived applications after an owner-set period (pg_cron or a scheduled function).
- **Dashboard extras:**
  - A "New applications" widget.
  - Global search extended to applications.

**Tests (spec §50):**
- submit
- review
- convert
- anon can't read applications or files
- rate limit triggers
- a non-image upload is rejected

**Complete when:**
- A submission from a phone reaches the queue on staging with photos.
- Conversion creates a correct draft talent.
- Emails arrive with SPF/DKIM passing.

**Risks if skipped:**
- New talent keeps coming in through a disconnected tool.
- Spam and storage-cost attacks.
- Minors' photos with GPS data exposed.
- Consent non-compliance.

**Deliverable:**
- The public Join and Contact forms.
- The application and inquiry queues.
- The conversion flow.
- Migration 021.
- Email integration.

---

### Phase 12 — CMS, website content and brand completion

**Objective:** staff manage website content without code, and the public site reaches launch quality: brand, pages, SEO and legal pages (spec Phase 11, §31, §36–38, §47).

**Depends on:**
- 10: the talent grid reuses its search.
- 11: the form block.

**Tasks**

- **Database (migration `022_*`):**
  - Tables: `website_pages`, `website_sections`, `website_navigation`, `website_settings`, and page revisions.
  - Public views expose published pages only.
  - Uses the `cms-media` bucket and the `website.manage` permission.
  - Audit events: `cms.page_published` and `cms.page_unpublished`.
- **Blocks:**
  - Each block's JSON is validated with a Zod schema.
  - Block types: hero, rich text, image, video, CTA, board grid, talent grid, form, and an HTML/CSS block.
  - The **HTML block is sanitized server-side** with an allowlist: no scripts, event handlers or `javascript:` URLs.
  - **CSS is scoped** to the block's container, with `@import` and external `url()` stripped.
- **Workflow:**
  - Draft → preview (Next draft mode) → publish.
  - Revision history and rollback.
  - Navigation editor, merging board menus with CMS pages.
- **Pages** (content from the owner):
  - About
  - Contact
  - Join (hosts the Phase 11 form)
  - **Privacy Policy**
  - **Terms**
  - A cookie notice, if analytics are added
- **Brand:**
  - Apply the live gold/burgundy palette and logo.
  - Replace the Unsplash stock photos, then remove `images.unsplash.com` from `next.config.ts`.
  - Fix the dead Privacy and Instagram links.
- **SEO:**
  - Per-page title, description and OpenGraph image.
  - Structured data: `Organization`, and `ProfilePage` for adult talent only; no structured data for minors.
  - CMS pages added to the sitemap.
  - Drafts and preview marked noindex.
- **Redirect map:** from the live site's existing URLs to the new routes, ready for the domain cutover in Phase 17.
- **Dashboard:** "Website drafts" and "Publication errors" widgets.

**Tests:**
- An XSS payload suite (OWASP cheat-sheet vectors) against the sanitizer.
- Custom CSS cannot style anything outside its block, and never affects the dashboard.
- Draft pages return 404 publicly.
- Publishing revalidates the page.

**Complete when:**
- The owner can build and publish a page alone.
- Lighthouse SEO and accessibility scores are 95 or higher on key pages.
- No stock or placeholder content remains.

**Risks if skipped:**
- Stored XSS in the HTML block can hijack staff sessions.
- Every content change needs a developer.
- Search ranking is lost at cutover without redirects.
- Launch happens without a privacy policy, which is a legal risk when collecting minors' data.

**Deliverable:**
- The CMS module.
- Branded public pages.
- Legal pages.
- The redirect map.
- Migration 022.

---

### Phase 13 — Agency operations: clients, bookings, calendar, tasks

**Objective:** run day-to-day agency work in the system and fill the placeholder sections (spec Phase 12, §22–23, §39–40).

**Depends on:** 9.
**Reuses:** the existing `talent_usages`, `talent_appointments`, `talent_items`, `talent_rates` and `talent_agencies` tables.
**Owner decision first:** what "Finance" should cover. The spec doesn't define invoicing. The recommendation is booking fees, status and CSV export only; otherwise remove the menu item.

**Tasks**

- **Database (migration `023_*`):**
  - `companies` (clients and brands) and `company_contacts`.
  - `bookings`: client, talent (many), dates, option/confirmed/cancelled, rates, usage link.
  - `tasks`: assignee, due date, linked entity.
  - Links from `talent_usages` and appointments to bookings.
  - Date-range indexes.
  - New permissions: `companies.manage`, `bookings.view`, `bookings.manage`, `tasks.manage`, `finance.view`.
- **Screens:**
  - Companies and contacts CRUD.
  - Bookings with current and history views.
  - A calendar (month and week, filtered by talent and client) with double-booking and availability conflict warnings.
  - A tasks list with "my tasks".
  - An ICS export of a talent's schedule (read-only; two-way calendar sync is out of scope).
- **Dashboard:** real widgets for upcoming bookings, tasks due, and expiring documents (the latter already exists).
- **Global search** extended to companies, contacts, bookings and documents (spec §40).
- **Audit** on booking status changes and financial fields.

**Tests:**
- RLS per role (for example, booker manages bookings and creative can't see rates).
- Date filters.
- Conflict detection.

**Complete when:**
- The spec's Phase 12 verify list passes.
- No dashboard placeholder remains except Packages, which is done in Phase 14.

**Risks if skipped:**
- The agency keeps running in spreadsheets.
- Production shows "Soon" placeholders.
- Double bookings.

**Deliverable:**
- The operations module.
- Migration 023.
- Tests.

---

### Phase 14 — Comp cards, packages and client sharing

**Objective:** client-facing presentation tools that can't leak private data (spec Phase 13, §30, and the Packages menu item).

**Depends on:**
- 13: packages go to clients and companies.
- 10: selection queries.
- 6: approved media (done).

**Tasks**

- **Comp card builder:**
  - Primary and supporting images, restricted to **public-approved** images.
  - Approved measurements, agency branding and public agency contact details.
  - A web preview and a **PDF**, rendered server-side (for example `@react-pdf/renderer`, which is reliable on serverless hosting).
  - Stored in `comp-cards` with versions.
- **Packages:**
  - A curated talent selection for a client.
  - Shared by an **expiring, revocable, unguessable link**: store a hashed token with an expiry.
  - Noindex, with view tracking and an audit trail.
- **Exports:** permission-gated roster CSV exports for staff. Private fields only with the matching permission, and the export is logged.
- **Database (migration `024_*`):** packages, package items, share tokens, comp card records, with RLS.

**Tests:**
- Generated PDFs contain no private fields.
- Expired or revoked links return 404.
- Minors' guardrails are respected.

**Complete when:** the spec's Phase 13 verify list passes, including image quality on print.

**Risks if skipped:**
- Staff build comp cards by hand outside the system, where privacy controls don't apply.
- Share links that never expire.

**Deliverable:**
- The comp-card and package modules.
- Migration 024.

---

### Phase 15 — Talent portal

**Objective:** talent self-service with strict own-record isolation (spec Phase 14, §41).

**Depends on:**
- 13: appointments and availability.
- 11: the email and review-queue patterns.
- The database groundwork: the `talent` role and `current_talent_id()`, already in place.

**Tasks**

- **Account set-up:**
  - An invitation flow: staff invite, an email is sent, and the account is bound to the talent via `agency_members.talent_id`.
  - For minors, guardian accounts.
- **`/portal` routes:**
  - View own profile.
  - Edit approved contact fields.
  - Upload requested digitals, which go to `talent-private` marked pending review.
  - Submit availability, which feeds the Phase 13 calendar.
  - View appointments and approved documents (signed URLs, audited).
- **Change review:**
  - A `talent_change_requests` table.
  - Staff approve or reject in a queue.
  - **Nothing auto-publishes.**
- **Database (migration `025_*`):** extend own-record policies to every table the portal reads.

**Tests:**
- An automated check across **every table and bucket** that talent A can't read or write talent B.
- Sensitive agency fields (notes, rates, banking of others) stay hidden.
- Approval is required before any change applies.

**Complete when:** the spec's Phase 14 verify list passes on staging with two real talent test accounts.

**Risks if skipped:** the portal is optional for launch. But if it ships without this rigour, horizontal privilege escalation becomes the most damaging breach possible.

**Deliverable:**
- The talent portal.
- Migration 025.
- The isolation test suite.

---

### Phase 16 — Security hardening

**Objective:** a dedicated, evidence-based security pass over the complete system before launch (spec Phase 15, §44).

**Depends on:** 9–15, the complete feature set.

**Tasks**

- **Policy review:**
  - Review every RLS and storage policy, including the new tables from 019–025.
  - Add a **generated test** that fails if any table lacks RLS, or if any role/table access differs from the permission matrix.
- **Service role:** audit its use. Only `admin.ts`, server-only, with narrow operations.
- **Inputs:**
  - Zod validation on every route.
  - Generic error responses.
  - Review file-upload paths.
- **Rate limits:**
  - Tune Supabase Auth's rate limits.
  - Confirm rate limits on every public endpoint.
- **Headers:**
  - A nonce-based **Content-Security-Policy** (tuned for video embeds and Supabase storage).
  - Full security headers.
- **Accounts:**
  - **MFA (TOTP) required** for owner and administrator. Recommended for accounting, because of banking, legal and medical access.
  - Session lifetime review.
- **Permission editing:** an owner UI in Settings for changing the matrix (G22), so changes no longer need SQL, with audit.
- **Logs:** no PII or secrets in logs or error monitoring; set an audit-log retention policy.
- **Secrets and dependencies:**
  - Audit environment variables and **rotate all Supabase keys** before launch.
  - Dependency audit (`npm audit`, Dependabot).
- **Scanning:** an OWASP ZAP (or similar) scan of staging, or an external penetration test if the budget allows, because of minors', banking and medical data.
- **Privacy operations:**
  - A data-subject request process: export and delete talent/applicant data.
  - A documented data-retention policy (UK GDPR, CCPA).
- **Role testing:** test deliberately as each role: anon, talent, creative, booker, accounting, talent manager, read only, administrator, owner.

**Complete when:**
- No open High or Critical findings.
- Advisor shows 0 errors.
- `security-review.md` is rewritten with evidence and signed off.

**Risks if skipped:** a breach of minors', banking, legal or medical data, with the legal, financial and reputational damage that follows.

**Deliverable:**
- The updated security review.
- The generated policy test.
- CSP.
- MFA.
- Privacy runbook.

---

### Phase 17 — QA, release candidate and production launch

**Objective:** prove the system on staging, then launch on the real domain with monitoring and a rollback path (spec Phase 16, §62–65).

**Depends on:** 16.

**Tasks**

- **Release candidate:** tag `v1.0.0-rc.N` and run the full regression on staging:
  - migrations replayed on a clean database and on a populated one
  - RLS, acceptance and E2E tests
  - auth
  - storage
  - forms
- **Manual QA:**
  - Desktop and mobile.
  - Browsers: Chrome, Safari (including iOS), Firefox, Edge.
  - Accessibility: axe plus keyboard and screen-reader passes, targeting WCAG 2.2 AA.
  - SEO: meta tags, sitemap, redirects, noindex on drafts.
  - Performance: Core Web Vitals, image weight, and a load test on roster and search.
- **Data:**
  - Import or enter the real roster, boards and CMS content, with the owner.
  - Verify that no fictional or test data remains in production.
- **Operations:**
  - Verify error monitoring and alerts.
  - Rehearse rollback.
  - Take and verify a backup.
  - Write runbooks: incident, restore, owner recovery, key rotation.
  - Train staff.
- **Cutover:**
  - Point the `42modelmanagement.com` DNS at Vercel, with SSL and a canonical host.
  - Deploy the redirect map.
  - Update the Supabase Site URL and redirect URLs.
  - Get the Google OAuth consent screen verified for the production domain.
  - Check email DNS (SPF, DKIM, DMARC).
- **Launch:**
  - Follow the production deploy checklist (spec §63).
  - Run the smoke test (spec §64).
  - Hypercare for two weeks: daily error and log review.

**Complete when:** every item in the Production readiness section below is checked, and the owner approves the release candidate.

**Risks if skipped:**
- A broken or partially working launch.
- No proven recovery.
- Lost search rankings.

**Deliverable:** `v1.0.0` live on the production domain, with `launch-checklist.md` signed off.

---

### Optional earlier public launch

If the owner wants the new public site live before Phases 13–15:

- Run a scoped Phase 16–17 pass for the public surface and staff login after Phase 12, then launch.
- The full Phases 16–17 still run before calling the complete system production-ready.
- This adds roughly one extra QA and security cycle but gets the website out earlier.

### Owner decisions needed (and the phase that needs them)

| Decision | Needed by |
|---|---|
| Create a staging Supabase project; which Supabase plan (backups/PITR, image transformations) | 9 |
| Transactional email provider and sending domain | 9 |
| Keep Favorites / "Request info"? Is ethnicity a public filter? | 10 |
| Replace or sync GoHighLevel "Join Us"; retention period for rejected applications | 11 |
| Brand assets, real photography, About copy, legal text (privacy, terms) | 12 |
| Finance scope; keep the medical module and who can read it | 13 |
| Whether the talent portal is required for v1.0 | 15 |
| External penetration test budget | 16 |

---

## Part 4 — Production readiness

The application is **production-ready** only when all of the following are true. Release-day steps are in `launch-checklist.md`.

### Environments and delivery

- [ ] Staging and production are separate Supabase projects with separate keys, Auth users and Storage.
- [ ] Preview deployments never point at production.
- [ ] CI (lint, types, tests, build, secret scan) is required to merge into `main`, and `main` is protected.
- [ ] All migrations replay cleanly on a blank database and on a copy of production data in staging.
- [ ] A release-candidate tag passed full staging QA and has written owner approval.

### Security and privacy

- [ ] Every table has RLS, and the generated policy test matches the permission matrix. Storage policies are verified per bucket.
- [ ] Public views expose only approved fields. Filters can't reveal hidden values. Drafts, previews, share links and minors' data aren't indexed.
- [ ] The service-role key is server-only and used only in `admin.ts`. All keys were rotated before launch. No secrets are in the repo or client bundles.
- [ ] MFA is required for owner and administrator. Leaked-password protection is on. Email confirmation is on. Custom SMTP is working.
- [ ] Public forms have rate limiting and bot protection. Uploads are validated and EXIF is stripped. The HTML/CSS block is sanitized and scoped. CSP and security headers are live.
- [ ] Legacy public-bucket media has been migrated. The contract migration has been applied.
- [ ] Privacy Policy and Terms are published. Consent (SMS, guardian) is stored with wording and timestamp. The retention and data-subject request processes are documented.
- [ ] Phase 16 is signed off with no open High or Critical findings. Supabase advisor shows 0 errors.

### Functionality

- [ ] The Saih acceptance test (spec §51) passes in a real browser on staging and is smoke-tested on production.
- [ ] Every item in the spec's testing requirements (§50) is covered by automated tests: RLS, talent, boards, website, applications, portal isolation.
- [ ] No placeholder dashboard sections, stock images, dead links or fictional data remain in production.

### Quality

- [ ] Mobile and desktop QA passed on Chrome, Safari (including iOS), Firefox and Edge.
- [ ] WCAG 2.2 AA is met on key pages: keyboard, screen reader and contrast.
- [ ] Core Web Vitals are "good" on public pages. Search and roster are tested with a realistic data volume.
- [ ] SEO is in place: canonical URLs, meta and OpenGraph, sitemap, robots, structured data, and a 301 redirect map from the old site.

### Operations

- [ ] Error monitoring and uptime alerts go to a named person.
- [ ] Backups or point-in-time recovery are confirmed, and a restore has been rehearsed.
- [ ] A rollback plan is documented for this release (app deployment and database).
- [ ] Runbooks exist for incident, restore, owner recovery and key rotation.
- [ ] Staff are trained. The owner can manage team, boards, talent, publishing and CMS without a developer.
- [ ] Domain, SSL, email DNS and OAuth consent screen are verified for the production domain.
