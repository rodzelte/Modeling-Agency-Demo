# 42 Agency OS architecture

```mermaid
flowchart LR
  A[Dashboard /dashboard] -->|user session, RLS| B[(Supabase Postgres)]
  A -->|uploads| P[talent-private bucket]
  A -->|documents| D[talent-documents bucket]
  P -->|Make public copies| Q[talent-public bucket]
  B --> V[security_invoker public views]
  V -->|anonymous client| W[Public site /models]
  Q --> W
```

## Layers

- **Database (`supabase/migrations`).** This is the source of truth.
  - RLS on every table.
  - Permissions resolved through `has_permission()` from `role_permissions` (see `permissions.md`).
  - Triggers enforce publishing and archive rights and write audit events.
- **Server code.** Every Supabase call runs under the caller's session, so RLS applies.
  - `src/lib/agency-auth.ts` resolves the user, their membership and their permissions once per request.
  - `requireApi()` guards API routes and `requirePage()` guards pages.
  - **The only service-role client** is `src/lib/supabase/admin.ts` (server-only). It is used only by the GHL webhook (`/api/integrations/ghl`), which has no user session and authenticates with a shared secret. `tests/unit/boundaries.test.mts` fails if anything else imports it.
- **Dashboard (`src/app/dashboard`, `src/features/*`).** Server-rendered pages load data per request. Client components post to `/api/dashboard/*` and call `router.refresh()` through `useMutation()`.
  - Shared UI lives in `src/components/ui`.
  - Talent sub-modules are driven by one registry: `features/talent/modules.ts` (API) and `features/talent/fields.ts` (forms and tables).
- **Public site (`src/app/models`, `src/features/public`).** Reads only the public views, through `createPublicSupabaseClient()`: the anonymous role, never the visitor's session.
  - `/models/[...path]` resolves board paths (`/models/teens/boys`) or talent slugs (`/models/<slug>`).
  - `/models` is a server-side search (`features/public/search.ts`, pure helpers in `filters.ts`). Filters live in the URL, so results are shareable. They run only on public-view columns, which are NULL when a talent hides them, so filtering cannot reveal hidden values. Results are paged 24 at a time. Filtered URLs are `noindex`.
- **Caching.**
  - Public reads are wrapped in `publicCache()` (`features/public/cache.ts`): `unstable_cache` with the `public-site` tag, refreshed every 5 minutes.
  - Every dashboard mutation route calls `refreshPublicSite()`, which invalidates the tag after the response. Publishing therefore still shows on the next page view.
  - Pages call `connection()` to render per request from cached data. Don't use `dynamic = "force-dynamic"` on public pages: it bypasses `unstable_cache`.

## Talent publication flow

1. Staff create a draft (`talent.create`).
2. Staff add details, measurements and boards, and upload media. Uploads go to `talent-private`.
3. "Make public" copies approved images to `talent-public`. The original is kept.
4. Publishing (`talent.publish`) sets `publication_status = 'published'` and `show_on_website = true`. A trigger checks the permission and writes the audit event.
5. The public views show the talent when it is published, visible, and not archived.
   - Board pages add one more condition: an assignment to a board that is itself public, meaning it and all its parents are active, published and not internal.
6. **Preview profile** (`/preview/talent/[id]`) renders the same public view for any status, with warnings about what will not be shown.

## Applications flow (GoHighLevel)

The Join Us form stays on GHL (`/join` redirects there). A GHL workflow posts each submission to `/api/integrations/ghl`.
- `features/applications/ghl.ts` maps the payload by field label.
- `ingest.ts` upserts one application per GHL contact, then downloads photos in `after()`. Photos are re-encoded as JPEG to strip EXIF/GPS and stored in the private `applications` bucket.
- Staff review in `/dashboard/applications` and convert with `convert_application()`, which also copies photos into `talent-private`.
- `scripts/import-ghl.mjs` back-fills past submissions through the same endpoint.

See `ghl-integration.md`.

## Website CMS

- **Editing:** staff edit pages in `/dashboard/website` (`features/cms`). A page is a list of typed sections: hero, text (a safe Markdown subset), image, video, call to action, talent grid, board grid, contact, and custom HTML.
- **Validation:** `blocks.ts` validates every section with Zod on save and again on read.
- **Custom HTML and CSS:** HTML is sanitised with an allowlist when saved and again when rendered (`sanitize.ts`). CSS is parsed with PostCSS, scoped to `[data-cms-block="<id>"]`, and stripped of `@import`, external `url()`, `expression()` and `position: fixed`.
- **Publishing:** publishing snapshots a revision. The public catch-all route `app/[...slug]` renders the live revision. For unknown paths it checks Website → Redirects before returning a 404.
- **Previews:** `/preview/page/[id]` shows the working copy to editors.
- **Home page:** hero, about and contact text and images come from `website_settings`. Until images are chosen, the first published talent photo is used, never stock photography.

## Operations

- **Screens:**
  - Companies and contacts.
  - Bookings (`features/operations`), whose form warns live about double bookings.
  - Calendar: a month grid bucketed in the agency time zone (`AGENCY_TIME_ZONE`, America/Chicago), with a phone list view.
  - Tasks.
  - Finance: totals per currency and a CSV export with formula-injection protection.
- **Access:** fees are only loaded for `finance.view`.
- **Calendar files:** a single booking or a talent's next 12 months download as `.ics`. This is read-only, with no calendar sync.
- **Booking form:** renders in the browser only, so date/time inputs use the viewer's time zone without server/client mismatches.

## Comp cards, packages and exports

- **Comp cards** (`features/compcard`):
  - A two-sided 5.5 × 8.5 in PDF rendered on the server with `@react-pdf/renderer`.
  - Uses only photos approved for public use and public measurements. Photos are re-encoded to JPEG with sharp.
  - Contact details are the agency's, from Site settings.
- **Packages** (`features/packages`):
  - Staff curate talent for a client and share `/p/<token>`.
  - The page calls `get_shared_package()` through the anonymous client. It is marked noindex, no-store and no-referrer.
- **Roster CSV:** private columns only with `talent.private.view`. The export is audited and formula-safe.

## Talent portal

- **Sign-in:** `/portal/login` sends a magic link (`signInWithOtp`). `/auth/callback` or `/auth/confirm` then lands the talent on `/portal`. The membership binds on email confirmation, exactly like staff accounts.
- **Pages:** portal pages live in the `app/portal/(app)` route group, guarded by `requirePortal()` (`features/portal/context.ts`), which calls `portal_profile()`.
- **Isolation:** every portal query runs as the talent, so RLS limits it to their own rows (`current_talent_id()`).
- **Staff tools:** each talent's Portal tab (invite, revoke, requests, availability) and the Talent requests queue.

## Board flow

Boards form a tree. Each board's `path_segment` is unique among its siblings, and its URL is the chain of segments. Assigning or removing a board changes only `talent_board_assignments`, and those changes are audited. Deactivating or unpublishing a board hides it from the website without touching talent.

## Media flow

- **Photos:** upload to `talent-private`, add metadata, order with `reorder_talent_photos()`, choose the primary with `set_featured_photo()`, then publish, withdraw or archive. Publishing copies the file into `talent-public`; withdrawing removes that copy.
- **Portfolios and digital books:** ordered sets of the talent's photos. Only public images ever show on the website.
- **Videos:** YouTube or Vimeo embeds, or files uploaded privately and promoted like photos.

## Sensitive data

- **Legal, banking and medical:** each needs its own permission. Changes are audited by trigger without copying values, and banking numbers are masked in the UI; a reveal is logged.
- **Documents:** stored in the private `talent-documents` bucket and downloaded only through a 60-second signed URL. Each download is logged.
