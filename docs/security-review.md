# Security review

_Last updated 2026-09-30 (Phase 16, migrations 009–025). Every rule below is enforced in the database or the proxy and is covered by an automated test. The test file is named in brackets._

## Summary

| Area | Status | Evidence |
|---|---|---|
| RLS on every table; views are `security_invoker` | ✅ | Generated check over the whole schema [`rls/hardening`] |
| Anonymous access | ✅ | Reads only the allow-listed public relations and functions, writes nothing, and uploads to no bucket [`rls/hardening`, `rls/public-views`] |
| Role resolution and privilege escalation | ✅ | Roles come only from `agency_members`, bound to a confirmed Auth user. The S1 exploit is fixed [`rls/security`] |
| Permission matrix | ✅ | Data-driven; the owner edits it in Settings. The owner always keeps every permission; the talent role can never be granted staff permissions; every change is audited [`rls/hardening`] |
| Talent isolation (portal) | ✅ | Talent A can never read or write talent B. Private details only through the allow-listed `portal_profile()`. Changes are requests that staff approve [`rls/portal`] |
| Public site and search | ✅ | Hidden measurements and age are NULL in the views, so filters cannot reveal them [`rls/search`] |
| Client package links | ✅ | 256-bit tokens with only the SHA-256 hash stored. Links expire and can be revoked. Public-safe fields only [`rls/packages`, `unit/packages`] |
| GHL webhook | ✅ | Constant-time shared-secret check, 512 KB body limit, fixed photo hosts (no SSRF), photos re-encoded to strip EXIF/GPS [`unit/ghl`, e2e] |
| Service-role key | ✅ | Used only by `src/lib/supabase/admin.ts` (`server-only`), imported only by the GHL webhook [`unit/boundaries`] |
| CMS HTML/CSS | ✅ | Allowlist sanitiser on save and render; CSS scoped with PostCSS; OWASP XSS vectors tested [`unit/cms`, `rls/cms`] |
| Open redirects | ✅ | `safePath()` for sign-in redirects; redirect and navigation targets cannot be protocol-relative (database constraints) [`rls/cms`, e2e] |
| Content-Security-Policy and security headers | ✅ | Tested against the production build with no violations [e2e "content security policy"] |
| MFA for owner and administrator | ✅ | Enforced in pages (`/login/mfa`) and API routes (`needsMfa` returns 403). A Google sign-in from the last 30 days counts as the second step [`unit/mfa-policy`] |
| Exports | ✅ | Finance and roster CSVs are formula-injection safe and audited. Private roster columns need `talent.private.view` [`unit/operations`] |
| Data-subject requests | ✅ | Owner can export all data about a talent as JSON, and erase a talent (files, then record) or an application. Erasure is audited without personal data |
| Dependencies | ✅ | `npm audit --omit=dev`: 0 vulnerabilities (2026-09-30); Dependabot runs weekly |

## Threat model and controls

### Authentication

- **Sign-in methods:** Supabase Auth with email/password, Google OAuth, and magic links (talent portal).
- **Email confirmation:** required before a membership binds (trigger in 009).
- **Owner and administrator:** need a second step. `getAgencyContext()` treats their session as unauthorised unless it is `aal2` (TOTP code) **or** its `amr` claim shows a Google (`oauth`) sign-in within the last 30 days, and the account is linked to Google (`src/lib/mfa-policy.ts`). Otherwise pages redirect to `/login/mfa`, which offers "Continue with Google" or a TOTP code, and APIs return `403 mfa_required`.
  - Owner decision (2026-10-01): Google's own account verification is accepted as the second factor. Residual risk: a compromised Google account gives dashboard access, so 2-Step Verification should stay on for those Google accounts.
  - The roles are configured with `MFA_REQUIRED_ROLES` (default `owner,administrator`).
  - Emergency override: set `MFA_REQUIRED_ROLES=none` (see `operations.md`).
- **Password reset:** `/login/forgot` → email → `/auth/confirm` (token hash) → `/login/reset`. It signs out every session afterwards.
- **Sign-in audit:** every sign-in is audited by trigger (`auth.login`, or `auth.login_unapproved` without an email).

### Authorisation

- **Layers:** RLS is the boundary. `requireApi()`/`requirePage()` give early, clear errors, and navigation hiding is cosmetic only.
- **Proxy routing:** `src/lib/supabase/proxy.ts` keeps talent logins out of `/dashboard` and staff out of `/portal`.
- **Money:** `booking_financials` and `booking_talent_fees` sit behind `finance.view`/`finance.manage`, so staff who can see the schedule never see fees.
- **Sensitive modules:** legal, banking and medical changes are audited without values. Banking numbers are masked, and revealing them is logged.

### Anonymous surface

The generated test pins the anonymous surface:
- **Reads:** 8 public views and the tables behind them (row policies for published rows, plus column grants), CMS tables (live rows only), and `website_redirects`.
- **Functions:** `talent_public_age`, `talent_is_public`, `get_shared_package` and `record_redirect_hit`.

A new table, view or function that becomes reachable fails CI until it has been reviewed.

Migration **025** removed leftover default grants: anon had INSERT/UPDATE/DELETE on the older talent-module tables. RLS already blocked every row. New tables no longer grant anon anything by default.

### Files

| Bucket | Contents | Access |
|---|---|---|
| `talent-private` | Originals, portal uploads | Staff with `media.view`; talent only their own folder; talent upload only to `talent/<id>/portal/` |
| `talent-public` | Approved copies | Served by URL, not listable. A photo cannot become public until it is approved |
| `talent-documents` | Documents | `documents.view`; talent only documents shared with them. Downloads use 60 s signed URLs and are audited |
| `applications` | GHL application photos | Written only by the webhook (service role); staff read with `applications.view` |
| `cms-media` | Website images | Public; editors write; SVG not accepted |

- **Size and type limits:** every bucket has size and MIME limits.
- **No listing:** anon cannot list or upload anywhere [`rls/hardening`].

### Browser

- **CSP:**
  - `default-src 'self'`.
  - Scripts only from this site. Inline scripts are allowed because Next.js needs them; there is no nonce because static pages must keep working.
  - Images, media and connections only to this site and Supabase.
  - Frames only for YouTube and Vimeo. `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- **Other headers:** HSTS with preload, `nosniff`, a strict referrer policy, `X-Frame-Options: DENY`, COOP, and a Permissions-Policy that allows the camera for this site only.
- **Caching and indexing:** signed-in areas are sent with `Cache-Control: private, no-store`. `/p/*` package links are `noindex` with no referrer.
- **Why `'unsafe-inline'` is acceptable:** the only user-authored HTML (CMS blocks) is sanitised to drop every script vector, so there is no injection path to exploit it.

### Privacy (UK GDPR / CCPA)

- **Minors:** no public DOB, address or contacts. Guardians are required for applicants under 18. No structured data about talent.
- **Consent:** SMS consent is stored with its wording (GHL).
- **Retention:** rejected and archived applications are purged after 12 months with `purge_stale_applications()`.
- **Access and erasure requests:** Talent → Privacy (export JSON / erase) and Application → Erase. Both are owner only and audited.
- **Logging:** logs and error alerts carry identifiers and error codes only, never personal values (`src/lib/log.ts`).

## Findings history

| ID | Finding | Status |
|---|---|---|
| S1 | Self-escalation through `profiles.role` and `profile_roles` | Fixed in 009 |
| S2 | Public bucket listable; uploads public by default | Fixed in 009. The legacy-media check found 0 files to move |
| S3 | `audit_log` without RLS | Fixed in 009 |
| S4 | Public views exposed DOB and legal names | Fixed in 009, 010 and 017 |
| S5 | Private contact fields readable by all staff | Fixed in 012 (moved to `talent_private_details`); old columns dropped in 019 |
| S6 | Banking unmasked; no separate medical permissions | Fixed: masking and reveal audit, `medical.*` permissions (011), value-free audit (016) |
| S7 | Raw database errors returned to clients | Fixed: `databaseError()` |
| S8 | Anon kept default write grants on older tables | Fixed in 025; found by the generated test |
| S9 | Talent could read staff notes and login flags on their own private-details row | Fixed in 024 (`portal_profile()` allow-list); found while building the portal |
| S10 | CMS links and redirects accepted protocol-relative `//host` targets (open redirect) | Fixed before release in 021; found by the CMS tests |

## Owner actions still required (dashboard settings, not code)

1. **Supabase Auth:**
   - Turn on leaked-password protection.
   - Set up custom SMTP with `ghl@modelluxemedia.com`.
   - Keep TOTP MFA enabled (it is on by default).
   - Set the minimum password length to 10.
2. **Rotate keys before launch:** rotate the Supabase publishable and secret keys, then set `SUPABASE_SECRET_KEY`, `GHL_WEBHOOK_SECRET` and `ERROR_ALERT_WEBHOOK_URL` in Vercel.
3. **Backups:** the Supabase plan should include daily backups (Pro) before real talent data is loaded.
4. **External testing:** consider an external penetration test before launch, given the minors', banking and medical data. The automated suite covers the application's own rules, not Supabase or Vercel infrastructure.

## Automated tests

`npm test` runs all 200+ tests: database rules for every role on PGlite, pure-logic unit tests, and architecture guard rails. `npm run test:e2e` runs the browser tests; CI runs them when enabled.

The PGlite stand-ins approximate Supabase. Storage API behaviour beyond `storage.objects` RLS, and PostgREST specifics, are covered by the browser tests and manual QA (Phase 17).
