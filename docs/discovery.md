# Discovery & technical audit (Phase 0)

_Last updated: 2026-09-29, audited at commit `e42cf22`. This replaces the earlier discovery note, which was written when the workspace was empty._

> **Status:** Phases 1–8 are implemented (migrations 009–018, the dashboard, and the public site). See `docs/architecture.md`, `docs/permissions.md` and `docs/security-review.md` for the current state, and `docs/staging.md` for release status. The findings below record the state at audit time.

This compares the repository and the tracked Supabase migrations with `42_Agency_OS_Claude_Master_Prompt.md`. Nothing in the application or the database was changed during the audit.

## 1. How this audit was performed

| Source | Status |
|---|---|
| Repository: all 69 tracked files, all 8 migrations, all routes/components | Read in full |
| `npm run lint`, `tsc --noEmit`, `npm run build` | All pass (0 errors) |
| Live Supabase project `dvpockrupiovuxcenuiy`: exposed schema object list | Checked (schema only, no row data) |
| Live Supabase: anonymous RLS probes | **Not performed.** Read-only probes against production were not authorised in this session. Section 5 findings come from reading the migrations and must be confirmed against the live database. |
| Current public site `42modelmanagement.com` | Nav, search and contact pages inspected. Talent grids and profiles are JS-rendered and could not be read. |
| CDS (`go.cdsglobal.com`) reference screenshots | **Not supplied in this session.** The tab list in the spec was used as the proxy. |

## 2. Current architecture

- **Stack:** Next.js 16.3.6 (App Router), React 19.2, TypeScript 5, Tailwind 4, `@supabase/ssr` 0.12, `supabase-js` 2.117, Zod 4 and lucide-react. There is no form library and no test framework.
- **Layout:** Flat `src/app` + `src/lib`. There are no `features/` modules yet. Business logic lives in API route handlers, and the dashboard UI is two large client components: `DashboardShell.tsx` (20 KB) and `TalentEditor.tsx` (23 KB, mostly single-line JSX).
- **Supabase clients:**
  - Browser client: `src/lib/supabase.ts`.
  - Server client: `src/lib/supabase/server.ts`.
  - Session refresh and the dashboard gate: `src/lib/supabase/middleware.ts`.
  - There is **no admin/service client**. `SUPABASE_SECRET_KEY` is declared but never read, so no server secret can reach the browser.
- **Data access pattern:** Dashboard API routes use the *user-scoped* server client, so RLS is the real enforcement layer. Each route also runs app-level role checks through `getAgencyContext()`.
- **Deployment:** Vercel from `main`, pointing directly at the production Supabase project. There is no staging project and no staging branch.

### Routes

| Route | Type | Notes |
|---|---|---|
| `/` | Public, dynamic | Home page. The talent grid comes from `public_talent_directory`. Hero and about images are Unsplash stock. |
| `/models` | Public, dynamic | Roster with client-side name search and board chips. The chip names are hard-coded. |
| `/models/[slug]` | Public, dynamic | Profile page from `public_talent_profiles`. |
| `/login`, `/auth/callback` | Public | Email/password and Google OAuth. |
| `/dashboard` | Protected | Single client page; tabs switch in local state. |
| `/api/dashboard/me, overview, boards, talents, team` | API | Read/write endpoints. |
| `/api/dashboard/talents/[id]` + `/measurements, notes, contacts, addresses, skills, media, operational/[module]` | API | Talent detail, update, and add-row endpoints. There are **no update or delete endpoints** for any sub-record. |
| `middleware.ts` | Edge gate | Uses the file name Next 16 **deprecated**; it should be renamed to `proxy.ts` (see `node_modules/next/dist/docs/.../proxy.md`). |

## 3. Database (as tracked in migrations and confirmed exposed in the live project)

Live REST-exposed objects: `profiles, roles, profile_roles, agency_members, audit_log, audit_logs, boards, talent, talent_board_assignments, talent_measurements, talent_photos, talent_private_details, talent_addresses, talent_contacts, talent_social_accounts, talent_skills, talent_notes, talent_legal, talent_banking, talent_agencies, talent_documents, talent_items, talent_usages, talent_appointments, talent_medical`. It also exposes two views, `public_talent_directory` and `public_talent_profiles`, and four RPCs: `has_role`, `has_any_role`, `is_active_agency_member`, `rls_auto_enable`.

Notes:
- **Schema drift:** the live function `rls_auto_enable` is not defined in any migration. Migrations 001 and 002 also say they "extend the existing agency schema". Production had tables *before* the migrations existed (for example `talent.date_of_birth NOT NULL`, `talent_photos.is_cover`, `portfolio_order` and `publish_to_website`). **Replaying the migrations on a blank database will not reproduce production exactly.** A schema-only dump plus a diff is needed before a staging project can be trusted.
- **Table names:** the tables are `talent` (singular) and `talent_board_assignments`, not the spec's `talents` and `talent_boards`. Keep the existing names; renaming would be destructive for little benefit.
- **Two audit tables:** `audit_logs` has the spec's shape and RLS, but **nothing writes to it**. `audit_log` is the legacy table the app writes to. Those inserts never check for errors, and migration 001 creates `audit_log` **without enabling RLS**.
- **No enum or check constraints** on `publication_status`, `talent.status`, `gender` or `image_type`. They are all free text.
- **Roles** are stored in three places: `agency_members.role` (used by the app), `profiles.role`, and `profile_roles`. RLS helpers accept a match in *any* of the three.

## 4. Spec coverage

✅ done · 🟡 partial · ❌ missing

| Spec area | State | Evidence / gap |
|---|---|---|
| Ph1 Auth, roles, allowlist | 🟡 | Login, Google OAuth, owner allowlist and Team panel all work. **The RLS role model can be escalated by users themselves (see S1).** There is no `permissions`/`role_permissions` table. |
| Ph1 Storage buckets | 🟡 | All six buckets exist. Policies exist only for `talent-public`. No size or MIME limits. |
| Ph1 Audit logging | 🟡 | Writes go to the legacy `audit_log` and ignore failures. There is no login, publish or sensitive-access logging and no `before_data`. |
| Ph2 Dashboard shell | 🟡 | Sidebar, overview and mobile drawer are in place. Media library, Applications, Documents, CMS and Settings are placeholder panels, visible to the owner only. There are no URL routes per section, no shared table/form/dialog/toast components, and no global search. |
| Ph3 Talent core | 🟡 | Create, list, edit, draft/review/published/archived status, and all 16 tabs are present. There is no archive/restore action, no "Preview website profile", and no age calculated from DOB. The list API returns 403 for booker, creative and read_only users. |
| Ph4 Boards | 🟡 | The table has hierarchy and visibility columns. **There is no board CRUD UI or API.** The UI and `PATCH` support only **one board per talent**: they delete every assignment, then insert one. |
| Ph5 Measurements, skills, contacts, addresses, agencies | 🟡 | Measurements are append-only history (good). All five modules are add-only: there is no edit or delete. Imperial values are shown only on the public height. |
| Ph6 Media | 🟡 | Multi-file upload to Storage and metadata rows work. **Uploads default to `public=false` and nothing can toggle them, so no image can ever reach the public site** (see F1). There is no reorder, featured image, archive, videos, portfolios or digital books. |
| Ph7 Sensitive modules | 🟡 | Legal, banking and medical tables exist with role-restricted RLS. Values are returned unmasked, and access is not logged. Documents store a *typed-in path*: there is no real private upload and no signed URLs. |
| Ph8 Public site | 🟡 | Server-rendered directory and profile pages read from views. There are no board pages, no SEO metadata, sitemap or robots file, and no `notFound()`. Supabase image hosts are not allowed in `next.config.ts` (F2). |
| Ph9 Search/filters | ❌ | Only a client-side name filter. The live site already has advanced search (Age, Hair, Height, Eyes, Waist, Hips, Ethnicity, Portfolio). |
| Ph10 Applications | ❌ | None. Today the live "Join Us" goes to an external GoHighLevel funnel (`funnel.modelluxemedia.com`). |
| Ph11 CMS | ❌ | None. |
| Ph12 Bookings, calendar, tasks | 🟡 | Per-talent usages and appointments rows exist, stored as free-text client and booker. There are no clients, companies, calendar or tasks. |
| Ph13 Comp cards | ❌ | None. |
| Ph14 Talent portal | ❌ | The `talent` role exists, but there is no user-to-talent mapping and no own-record RLS. |
| Ph15/16 Security, QA, tests | ❌ | No tests, CI, error monitoring or rate limiting. `docs/*.md` describe intent rather than the implementation. |

## 5. Security findings (from reading the migrations; confirm on live before and after fixing)

**S1: CRITICAL: any signed-in user can make themselves owner.**
- The policy `"agency owners can manage profiles"` (migration 005) is `FOR ALL … USING (id = auth.uid() OR has_role('owner'))`. Every user can therefore update **their own** `profiles.role` and `profiles.email`.
- `has_role` and `has_any_role` trust `profiles.role`, and they join `agency_members` on `profiles.email`.
- **Attack:** a user sets `email` to an active owner's email and `role = 'owner'` on their own profile row. After that, every RLS check passes for them, including `talent_banking`, `talent_legal`, `talent_medical` and `agency_members`. They get this by calling the Supabase REST API directly with the public browser key; the Next.js UI is never involved.
- **Who can do it:** Google OAuth is enabled, so anyone with a Google account can probably get an Auth user. A read-only staff member can escalate even more easily: setting `profiles.role='administrator'` alone passes every `has_any_role` check.
- `profile_roles` has the same self-write flaw: `profile_id = auth.uid()` is allowed `FOR ALL`.
- **Fix:** users must not be able to write `role`, `email` or `status`. Resolve roles only from `agency_members` matched on the JWT email (or from owner-managed `profile_roles`), and drop the implicit `'admin'` grants.

**S2: HIGH: every talent image is publicly readable and listable.**
- All dashboard uploads go to the `talent-public` bucket, which is `public = true`. There is also an anonymous `SELECT` policy on its objects, which lets anyone list the bucket.
- As a result, draft, internal and minors' images can be enumerated and downloaded, whatever the talent's publication status or the image's `public` flag.
- The bucket also has no file-size or MIME limits.
- **Fix:** upload to `talent-private` first, and copy or promote a file into `talent-public` only when it is approved. Remove the anonymous list access.

**S3: HIGH (verify): `audit_log` may be world-readable and writable.**
- Migration 001 creates it without `enable row level security`. Supabase grants `anon` and `authenticated` access by default.
- The app writes full PATCH payloads into it, which include DOB, phone and email.
- The unexplained live `rls_auto_enable` function may or may not already mitigate this. It needs to be checked.

**S4: HIGH: public views expose exact DOB and legal names.**
- `public_talent_directory` and `public_talent_profiles` return `date_of_birth`, `first_name` and `last_name` to anonymous users, including for minors.
- The spec forbids exposing exact DOB. The views should return a derived age, or nothing when `is_minor` is set or age display is disabled.
- The views run with the owner's rights, bypassing RLS. That is intentional for a projection, but the column list must stay minimal.

**S5: MEDIUM: private contact fields are visible to every staff role.**
- `mobile`, `phone`, `email`, DOB and minimum rates live on `talent`, which every staff role can read, including creative and read_only.
- The spec puts these in a private table.

**S6: MEDIUM: sensitive values are unmasked and unlogged.**
- `GET /api/dashboard/talents/[id]` returns bank account and routing numbers in plaintext, and viewing them is not logged.
- Medical data is readable by `talent_manager`. The spec asks for a separate permission.

**S7: LOW:**
- `POST /talents` has no app-level role check; it relies on RLS alone.
- Database error messages are returned to the client verbatim.
- Uploads have no rate limiting.

## 6. Functional bugs that block the release-blocking Saih acceptance test

- **F1:** Uploaded photos are always saved with `public=false`, and no control can change that. Profile galleries and card images therefore stay on the placeholder forever.
- **F2:** `next.config.ts` allows images only from `images.unsplash.com`. The first time a Supabase Storage image is published, `next/image` will throw on `/`, `/models` and the profile page.
- **F3:** There are no public board pages (for example `/models/teens/boys`). A talent's board can be changed but not *added* alongside an existing one, and there is no board-management UI.
- **F4:** No reorder feature for media.
- **F5:** The public height conversion rounds feet instead of flooring them. For example, 182 cm renders as `6' 12"`.
- **F6:** The `/models` board chips are hard-coded names ("Women / Mainboard" and so on) that don't match the seeded boards ("Women / Fashion", "Teens / Boys" and so on). Board filtering returns nothing.
- **F7:** A talent on two boards appears twice in `/models`, because rows are de-duplicated per board.
- **F8:** An unknown slug returns HTTP 200 with "Talent not found", not a real 404.
- **F9:** The overview reports hard-coded `upcomingEvents: 0` and `applications: 0`. The spec says metrics must not be fabricated.

## 7. Brand and content gaps against the live site

- **Navigation:**
  - Live site: Fashion · Development · Teens · Commercial · Speciality Talent · Join Us · Favorites · Search · Contact.
  - Repo: Models · About · Contact.
- **Boards:** The live categories don't match the seeded boards. Board definitions should come from the owner, not from the spec's example list.
- **Invented facts:** The repo copy says "established 2001", "Dallas · New York · Los Angeles" and `hello@…`. The live site says it was founded in 2015 by Lenny Wheeler, is a Dallas–Fort Worth agency with a "USA – UK" tag, and lists lenny@, submissions@ and yzza@ as contacts. **These invented facts should be corrected before launch.**
- **Visuals:** The repo uses a terracotta accent with Unsplash stock photography. The live logo is gold/bronze (`#D5A561`, `#C08F4D`) with burgundy (`#9E1923`).
- **Favorites:** The live site has a Favorites / "Request Info" shortlist that the spec doesn't mention. Decide whether to keep it.
- **Join form:** The live form collects about 25 fields plus three required photos (full body, headshot, 3/4) and SMS consent. Use it as the field list for Phase 10.
- **Dead code:** `src/lib/data.ts` still holds a fictional mock roster (including a "Saih Williams"). Only its `Talent` type is used.

## 8. Reusable vs. replace

**Keep:**
- Supabase SSR client setup.
- The allowlist and Team flow (after S1 is fixed).
- The talent and module tables.
- The measurement-history model.
- The public-view approach.
- The Zod-validated route pattern.
- The public page designs (restyle them to the brand).

**Refactor:**
- Split `DashboardShell` and `TalentEditor` into `features/*` modules and real routes, for example `/dashboard/talent/[id]/[tab]`.
- Add shared table, form, dialog and toast components.
- Replace the generic `operational/[module]` upsert with typed per-module handlers that support update and delete.

**Replace:**
- The role-resolution SQL helpers.
- Audit writes: use a single `audit_logs` table.
- The media upload path.

## 9. Migration risks

- The production schema is not fully captured in migrations, so rehearsing on staging requires a schema dump and diff first.
- Fixing S1 changes `has_role` and `has_any_role`, which every policy depends on. A mistake there could lock out the owner. Rehearse it on staging, and keep the owner restore SQL from the README at hand.
- Moving images from `talent-public` to `talent-private` is a storage migration. It needs a copy-then-verify script, not a bucket flip.
- Consolidating `audit_log` into `audit_logs` should be additive: keep the old table read-only and write to the new one.
- All future migrations must be additive: expand, migrate, then contract.

## 10. Recommended implementation sequence

1. **Phase 1b: Security foundation fix (next step)**
   - Staging Supabase project and a production schema dump/diff.
   - New migration `009_security_hardening.sql`:
     - Lock down `profiles` and `profile_roles` self-writes.
     - Rebuild `has_role` and `has_any_role` on `agency_members` plus the JWT email.
     - Enable RLS on `audit_log`.
     - Remove DOB and legal names from the public views.
     - Add bucket size and MIME limits.
     - Remove anonymous listing on `talent-public`.
   - Add `lib/supabase/admin.ts` (server-only), env validation, and `proxy.ts`.
   - Add a scripted RLS test suite that runs against staging for the anon, read_only, creative, accounting and owner roles.
2. **Phase 2 completion:** real dashboard routes, shared UI primitives, and role-aware navigation.
3. **Phases 4 and 6 together:** board CRUD, multi-board assignment, and media (private upload, promote to public, reorder, featured image). Fix F1–F7 here.
4. **Phase 8:** board pages and SEO, then run the **Saih acceptance test**.
5. Then Phases 9 → 10 → 7 hardening → 11 → 12–14, as in the spec.

### Files likely affected by the next phase

- `supabase/migrations/009_security_hardening.sql` (new).
- `src/lib/agency-auth.ts`.
- `src/lib/supabase/{server,admin,env}.ts`.
- `middleware.ts` → `proxy.ts`.
- `src/app/api/dashboard/**/route.ts` (audit helper, error handling).
- `src/lib/live-data.ts` (drop DOB).
- `next.config.ts` (Supabase image host).
- `tests/rls/*` (new).
- `docs/security-review.md`, `docs/permissions.md`, `docs/staging.md`.

## 11. Decisions needed from the owner

1. **Staging:** can we create a separate Supabase staging project now, before the security migration?
2. **Boards:** is the canonical list the live site's (Fashion, Development, Teens, Commercial, Speciality Talent, with sub-boards) or the spec's Women/Men split? Also, what URL scheme should board pages use?
3. **Applications:** should the GoHighLevel "Join Us" funnel be replaced by Supabase-native applications, or kept and synced?
4. **Medical:** should the module be kept at all? If yes, which roles may read it?
5. **Branding:** confirm the gold/burgundy palette, the real founding facts, and the contact emails for the new site.

## 12. Phase 1–8 implementation assessment (2026-09-30)

Starting point: `main` at `7f69b32`, with migrations 001–009 applied to production.

1. **What already exists**
   - Supabase Auth with Google and email sign-in.
   - An owner-managed allowlist, `agency_members`, bound to Auth user ids (009).
   - Row-level-security (RLS) role helpers.
   - An `audit_logs` table and the `write_audit()` function that writes to it.
   - All six storage buckets, with size and file-type limits.
   - The `talent` table and 16 per-talent module tables.
   - Append-only measurement history.
   - A private-first photo upload with a promote-to-public step.
   - Two owner-rights public views.
   - `/models` and `/models/[slug]`, which read those views.
   - A single-page client dashboard with a 16-tab editor.
   - A 40-test RLS suite that runs against PGlite.
2. **Reusable as-is**
   - The Supabase SSR clients, `proxy.ts`, and the env validation.
   - The auth context.
   - `databaseError()` and `writeAudit()`.
   - The Zod-validated API route pattern.
   - All existing tables. They keep their names; see the mapping below.
   - The RLS test harness.
   - The public page designs.
3. **Needs modification**
   - **RLS:** policies are hard-coded role arrays. Move them to data-driven permissions (`permissions`, `role_permissions`, `has_permission()`).
   - **Private fields:** contact, DOB and rate fields live on `talent`, where every staff role can read them. Move them to `talent_private_details` and lock the old columns out of the API with column grants (expand/contract; no data is deleted).
   - **Boards:** single-board assignment only, and no hierarchy data or management UI.
   - **Dashboard:** the single client page must become route-based pages that are enforced on the server.
4. **Missing**
   - Permission tables.
   - Visibility flags beyond `show_on_website`, `show_in_search` and `featured`.
   - A talent-user link (needed for "Talent A cannot read Talent B").
   - Publish-permission enforcement.
   - Archive and restore.
   - Board CRUD and hierarchy.
   - Skill and agency catalogues.
   - Videos, portfolios and digital books.
   - Photo reorder, featured image and archive.
   - Real document upload and signed downloads.
   - Banking reveal.
   - Public board pages and public-safe `*_view` views.
   - Portfolio, video and skill display on profiles.
   - Sitemap and robots.
5. **Database state:** the table names differ from the spec's. They are kept and mapped rather than duplicated:

   | This repo | Spec name |
   |---|---|
   | `talent` | `talents` |
   | `talent_board_assignments` | `talent_boards` |
   | `talent_photos` | `talent_images` |
   | `talent_banking` | `talent_financial` |
   | `talent_documents` | `documents` |
   | `talent_measurements` (append-only) | `talent_measurement_history` |

   A current-measurements view gives the spec's `talent_measurements` semantics.
6. **Supabase state**
   - There is one project (production) and no staging project.
   - Docker is not installed, so there is no local Supabase stack.
   - Production reads from this workstation are not permitted.
   - **Validation strategy:** every migration is replayed on PGlite with Supabase stand-ins, and RLS and acceptance workflows are tested there.
   - Nothing is pushed to production. Staging is prepared as runbook steps.
7. **Security / RLS concerns**
   - Private columns on `talent` (the S5 finding).
   - Medical data readable by talent managers.
   - No enforcement of who may publish.
   - Legacy photos sitting in the public bucket.
   - The talent-role portal has no own-record isolation.
8. **Migration requirements:** continue numbering at `010`. All migrations are additive and idempotent. Old columns and views are kept until a later contract migration, after staging verification.
