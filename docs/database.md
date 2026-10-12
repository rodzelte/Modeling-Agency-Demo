# Database

Migration order:

1. `001_foundation.sql` — profiles, roles, assignments, audit logs, role helpers.
2. `002_talent_core.sql` — boards, talents, private details, assignments, measurements, media, indexes, RLS.
3. `003_public_views.sql` — narrow public directory projection and grants.
4. `004_public_profiles_storage.sql` — public profile projection, storage buckets, and media policies.
5. `005_agency_access_control.sql` — email allowlist, role synchronization, and dashboard access policies.
6. `006_backfill_allowlisted_profiles.sql` — backfills profiles for approved Auth users created before the access trigger.
7. `007_talent_management_expansion.sql` — General fields, structured private details, skills, contacts, addresses, notes, and measurement-history fields.
8. `008_talent_operational_modules.sql` — Legal, banking, agencies, documents, items, usage, appointments, and medical modules with role-specific RLS.
9. `009_security_hardening.sql` — Binds `agency_members` to Auth user ids and makes it the sole role authority; locks `profiles`/`profile_roles`; enables RLS on `audit_log`; adds `audit_logs.before_data/after_data`, `write_audit()`, and publication/membership audit triggers; private-by-default media (`talent_photos.storage_bucket`, `public_storage_path`); bucket size/MIME limits; public views without DOB or legal names (`talent.show_age` opt-in). See `docs/security-review.md`.

10. `010_public_views_security_invoker.sql` — **Production hotfix.** Rebuilds `public_talent_directory` and `public_talent_profiles` as `security_invoker` views, which fixes Supabase advisor lint 0010. Anonymous visitors read them through anon-only policies on published rows and public-safe column grants. Age comes from `talent_public_age()`, which never exposes the DOB. The views keep the same columns, so the deployed site keeps working.
11. `011_permissions.sql` — `permissions` and `role_permissions` tables, `has_permission()`, and `current_permissions()`. Every talent-module policy is rebuilt on permissions. Adds `agency_members.talent_id` and `current_talent_id()` for talent logins. Also rebuilds the storage policies for media and documents.
12. `012_talent_core.sql` — Visibility flags plus minor and guardian fields. Private fields are copied into `talent_private_details`; the old `talent` columns are kept but withdrawn from the API with column grants. A publication, archive and edit permission trigger. Tables for multiple phone numbers/emails and for rates.
13. `013_boards.sql` — Board hierarchy with `path_segment`, cycle and depth guards, `board_path()`, and `reorder_boards()`. Legacy boards are arranged under category parents. Audit triggers for board changes and assignments.
14. `014_profile_modules.sql` — Measurement bookkeeping and the `talent_current_measurements` view. `skill_categories` and `skills`, backfilled from free text. Contact relationship types, extra address fields, and `agencies`, backfilled.
15. `015_media.sql` — Photo metadata, `reorder_talent_photos()`, and `set_featured_photo()`. New tables `talent_videos`, `portfolios` / `portfolio_images`, and `digital_books` / `digital_book_images`, with a same-talent guard and set-contents functions.
16. `016_sensitive_modules.sql` — Identification and finance fields on `talent_legal`. Stamping and value-free audit triggers for legal, banking and medical. Private document metadata, and documents are archived rather than deleted.
17. `017_public_views.sql` — `public_boards_view`, `public_talents_view`, `public_talent_media_view`, `public_talent_portfolios_view` and `public_talent_skills_view`, all `security_invoker`. Anon-only policies and column grants, respecting `show_measurements`, `show_videos` and `show_portfolio`. The 010 views are dropped.

18. `018_function_privileges.sql` — Removes API execute rights from trigger functions; Postgres fires triggers without checking them. Removes anonymous access to the role helpers and `board_path()`, and fixes the search path of `digital_book_published_at()`. This clears advisor lints 0011, 0028 and 0029, except the deliberate ones listed in `security-review.md`.

19. `019_release_foundation.sql` — **Contract step.**
    - Merges any leftover private values into `talent_private_details`, verifies them (and aborts if anything would be lost), backs the old columns up into `archive.talent_private_columns_019`, then drops them from `talent`.
    - Adds an `auth.login` / `auth.login_unapproved` audit trigger on `auth.users.last_sign_in_at`.
    - Revokes API execute rights on Supabase's `rls_auto_enable()` event-trigger function. The function itself is kept; it enables RLS on new tables automatically.

20. `020_applications.sql` — **Join Us applications from GoHighLevel.**
    - Tables: `applications` (one per GHL contact), `application_photos` and `application_notes`.
    - New permissions `applications.view` and `applications.manage`.
    - Staff can update only `status`. The raw GHL payload is not selectable through the API. Rows are written only by the server integration (secret key).
    - The `applications` bucket is readable with `applications.view`.
    - `convert_application()` creates the draft talent, private details, measurement, address, social account, guardian contact and note in one transaction.
    - `purge_stale_applications()` is owner-only retention.
    - Receipt, status changes and conversion are audited by trigger. See `ghl-integration.md`.

21. `021_cms.sql` — **Website CMS.**
    - `website_pages` holds the working copy.
    - `website_page_revisions` holds immutable published snapshots. `publish_website_page()`, `unpublish_website_page()` and `restore_website_revision()` are the only way to change what is live (a trigger blocks direct status edits).
    - Also `website_navigation`, `website_settings` (only public keys are exposed) and `website_redirects`. Redirect targets can never be protocol-relative.
    - Public `security_invoker` views: `public_pages_view`, `public_navigation_view` and `public_settings_view`.
    - New permission `website.publish`.
    - `cms-media` storage policies. The bucket no longer accepts SVG.
    - Seeds draft About, Privacy and Terms pages (the legal pages are marked for legal review) and default settings.

22. `022_operations.sql` — **Agency operations.**
    - Tables: `companies`, `company_contacts`, `bookings` (reference `BK-00001`; statuses option, confirmed, cancelled, completed), `booking_talent`, and `tasks`.
    - Money is kept apart in `booking_financials` and `booking_talent_fees`, behind the new `finance.view` and `finance.manage` permissions, and audited without amounts.
    - Existing `talent_appointments` and `talent_usages` rows can link to a booking.
    - `talent_booking_conflicts()` powers double-booking warnings.
    - Talent logins read only their own confirmed bookings (no money, no companies).
    - Tasks: members see and complete their own; operations managers assign and see all.

23. `023_packages.sql` — **Client packages.**
    - Tables: `packages` and `package_items`, with the `packages.manage` permission.
    - Share links store only the SHA-256 hash of a 256-bit token. Links expire and can be revoked or rotated.
    - `get_shared_package(hash)` is the only anonymous entry point. It returns public-safe fields and photos approved for public use, respects `show_measurements`, and counts views.
    - Created, shared and revoked events are audited.

24. `024_portal.sql` — **Talent portal.**
    - Talent no longer read `talent_private_details` or `talent_contacts` directly. `portal_profile()` returns an allow-listed view, with no notes, rates or login flags.
    - `talent_change_requests`: status is forced to pending on insert, fields are allow-listed per group, and `apply_change_request()` is staff-only and audited.
    - `talent_availability`.
    - `talent_photos.review_status`: talent may add pending photos only to `talent/<id>/portal/`, and a trigger blocks making an unapproved photo public.
    - `talent_documents.shared_with_talent`, with matching storage policies.
    - `invite_talent_to_portal()`, `revoke_talent_portal()` and `portal_access()`.

25. `025_security_hardening.sql` — **Security hardening.**
    - Revokes anon write privileges everywhere, and anon SELECT except on the public-site relations. Future tables no longer grant anon anything by default.
    - Guard rails on `role_permissions`: the owner keeps every permission, the talent role never holds staff permissions, and changes are audited.
    - Owner deletion of applications and talent files, for data-subject requests.

## Naming (spec → this schema)

These existing tables are kept rather than duplicated:

| Spec name | This schema |
|---|---|
| `talents` | `talent` |
| `talent_boards` | `talent_board_assignments` |
| `talent_images` | `talent_photos` |
| `talent_financial` | `talent_banking` |
| `documents` | `talent_documents` |
| `talent_measurement_history` | `talent_measurements` (append-only) |

## Column grants

- **`talent`** is readable and writable only through explicitly granted columns (012 for signed-in users, 017 for anon). A new column must be added to those grants deliberately.
- **Contract step (done in 019):** the old private columns on `talent` were dropped after verification. The `archive` schema holds the backup and is not exposed to the API.

## Tests

RLS regression tests: `npm run test:rls` (see `tests/rls/`).

All future schema changes must be added as migrations. Do not edit production tables manually.

The public views intentionally expose only identity, discovery, approved publication flags, board context, approved measurements, and public media paths. Banking, legal, medical, contact, address, notes, and documents are separate modules and are never part of the public projection.

The dashboard talent editor follows the 16 recommended record tabs: General, Other, Legal, Addresses, Contacts, Banking, Agencies, Stats, Skills, Documents, Items, Usage, Appointments, Medical, Notes, and Media. Modules with no records show an empty state rather than fabricated data.
