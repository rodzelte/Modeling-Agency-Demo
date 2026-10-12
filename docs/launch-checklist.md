# Launch checklist

Production-readiness criteria: [ROADMAP.md → Part 4](ROADMAP.md#part-4--production-readiness). QA evidence: [qa-report.md](qa-report.md).

## 1. Release v1.0.0

> **Status (2026-10-01):** steps 1–4 are done. Migrations 019–025 are applied, Phases 11–17 are on `main` and deployed, and the Vercel env vars are set. Steps 5–8 remain.

It went live in this order: **database first, then code.**

1. **Back up the database.** Supabase → Database → Backups (paid plans). Or run `npx supabase db dump --linked -f backups/pre-v1-schema.sql`, plus `--data-only` to a second file, and keep both outside the repo.
2. **Apply the migrations** from the repo folder:
   ```bash
   npx supabase db push --dry-run
   ```
   It should list **019 → 025**. Then apply them:
   ```bash
   npx supabase db push
   ```
   019 drops the old private columns on `talent`, after verifying they were copied and saving them to `archive.talent_private_columns_019`.
3. **Merge the code:**
   ```bash
   git checkout main
   git merge --ff-only release/phases-11-17
   git push origin main
   ```
   Vercel deploys it.
4. **Set Vercel environment variables** (Production), then redeploy:

   | Variable | Value |
   |---|---|
   | `SUPABASE_SECRET_KEY` | Supabase secret key (Secret) |
   | `GHL_WEBHOOK_SECRET` | `openssl rand -hex 32` (Secret) |
   | `ERROR_ALERT_WEBHOOK_URL` | Slack/Discord webhook (optional) |
   | `NEXT_PUBLIC_SITE_URL` | `https://<production domain>` |

5. **Supabase dashboard** (details in `operations.md`):
   - Custom SMTP with `ghl@modelluxemedia.com`
   - Email templates pointing at `/auth/confirm`
   - Leaked-password protection on
   - Minimum password length 10
   - Redirect URLs for `/auth/callback` and `/auth/confirm`
   - TOTP MFA enabled (default)
6. **Owner and administrators:** sign in, then complete two-step setup at `/login/mfa`.
7. **GHL:** create the "Form Submitted → Custom Webhook" workflow (`ghl-integration.md`) and submit one test entry. Optionally run `scripts/import-ghl.mjs` to bring in past submissions.
8. **Run the smoke test** (below) and `BASE_URL=https://<domain> npm run test:e2e`.

## 2. Content and business (owner)

- [ ] Review and publish **Privacy Policy** and **Terms** (Website → Pages). They are drafts marked for legal review.
- [ ] Rewrite and publish **About**. Set home-page text and images (Website → Site settings) and the Instagram link.
- [ ] Add **redirects** from the old site's URLs (Website → Redirects) before moving the domain.
- [ ] Confirm the **brand palette**: public accent burgundy `#9e1923` and gold `#d5a561`. Decide whether small uppercase labels stay at 10–11 px.
- [ ] Decide **Finance** scope (fees and invoice status now; no invoicing) and whether to keep the **Medical** module.
- [ ] Choose a **retention period** for rejected applications (default 12 months) and state it in the Privacy Policy.
- [ ] Create a **read-only test member** for CI browser tests: set GitHub secrets `E2E_EMAIL`/`E2E_PASSWORD` and the variable `E2E_ENABLED=true`.

## 3. Domain cutover

- [ ] Point `42modelmanagement.com` DNS at Vercel. Canonical host is `www` or the apex, with the other redirecting.
- [ ] SSL certificate issued. HSTS is already sent.
- [ ] Supabase Site URL and redirect URLs updated to the domain. Google OAuth consent screen verified for the domain.
- [ ] Email DNS for `modelluxemedia.com` (SPF, DKIM, DMARC) passing.
- [ ] Submit `https://<domain>/sitemap.xml` in Google Search Console.

## Every production release (routine)

### Before deploying

- [ ] CI green on the branch (lint, types, tests, build, gitleaks).
- [ ] Backup taken; `npx supabase db push --dry-run` reviewed. Any destructive step backs up its data in the migration and has owner approval.
- [ ] Vercel env vars correct for the release. No test data or keys in the build.
- [ ] Rollback noted: previous Vercel deployment and backup point.

### Deploy

1. `npx supabase db push`
2. Push or merge to `main`.
3. Watch error alerts and Vercel logs for 30 minutes.

### Smoke test (spec §64)

- [ ] Home, `/models`, a board page and a published profile load.
- [ ] Staff sign-in works, including two-step for owner/admin. Dashboard, talent list and a talent record load.
- [ ] A talent profile can be edited, and an image uploads and can be made public.
- [ ] A board assignment works and shows on the board page.
- [ ] A private or draft talent stays private.
- [ ] A GHL test submission appears under Applications, with photos.
- [ ] A CMS page publishes and appears. Its draft edits stay private until republished.
- [ ] Portal: an invited test talent can sign in and sees only their own data.
- [ ] A package link opens; after revoking, it shows 404.
- [ ] No CSP violations or server errors in logs. No protected data exposed.

### If something breaks

- **App:** promote the previous Vercel deployment.
- **Database:** roll forward with a fix migration. Restore the backup only if data was damaged. For 019, the archived columns are in `archive.talent_private_columns_019`.
