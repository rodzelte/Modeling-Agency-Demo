# Release process

The owner has decided there will be **one Supabase project**: production, `dvpockrupiovuxcenuiy`. There is no separate staging project, so each spec "staging" step is replaced with a safeguard that works against a single project:

| Spec step (§57–58) | What we do instead |
|---|---|
| Local development | `npm run dev` against production data, used for reading only. Never write test data to production. |
| Clean-database migration replay | `npm test` replays every migration on an in-memory Postgres (PGlite), with Supabase stand-ins |
| Populated-database rehearsal | Tests seed legacy-shaped data first (`tests/rls/harness.mjs`, `supabase/seed.sql`) |
| RLS review | RLS test suites per role. Phase 16 adds a generated policy-matrix test |
| Staging deploy and QA | CI on every push (`.github/workflows/ci.yml`), browser tests (`npm run test:e2e`), then Vercel's deployment preview |
| Migration dry run | `npx supabase db push --dry-run` before every push |
| Backup before destructive change | The migration copies affected data into the `archive` schema (not exposed to the API) before dropping it, and aborts if anything would be lost. The platform backup is taken as well. |
| Production smoke test | `launch-checklist.md` → Smoke test, plus `BASE_URL=https://<domain> npm run test:e2e` |

## Environments

| Environment | Database | App | Branch |
|---|---|---|---|
| Automated tests | PGlite in-memory Postgres (`npm test`) | — | any |
| Local | Production project; public pages are read-only | `npm run dev` | `main` or `feature/*` |
| Production | `dvpockrupiovuxcenuiy` | Vercel Production | `main` |

**Test data rule:** fictional data (`supabase/seed.sql`, anything `@example.test`) must never be written to production. Signed-in browser tests are read-only by design (`tests/e2e/staff.spec.ts`).

## Release routine

1. **Checks:** `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`, and `npm run test:e2e`.
2. **Secret scan:** run gitleaks locally, or confirm the CI "Secret scan" job is green.
3. **Migrations:** run `npx supabase db push --dry-run`. Read the SQL of every pending migration, then run `npx supabase db push`.
4. **Deploy:** push to `main`. Vercel deploys it.
5. **Verify:**
   - Run the smoke test.
   - Re-run the Supabase advisor.
   - Watch the logs and error alerts for 30 minutes.

**Ordering:** when a migration changes grants or drops columns the running app uses, deploy the matching app build immediately after `db push`.

**Continuous integration:** CI runs lint, the type check, the database tests, the build and gitleaks on every push. The browser-test job runs when the repository variable `E2E_ENABLED` is `true` and these secrets are set:
- `E2E_SUPABASE_URL`
- `E2E_SUPABASE_PUBLISHABLE_KEY`
- optionally `E2E_EMAIL` and `E2E_PASSWORD`: a `read_only` member's account, used by the signed-in checks

## Release history

| Date | Release | Notes |
|---|---|---|
| 2026-09-30 | 009 | Security hardening |
| 2026-09-30 | 010–017 | Phases 1–2 |
| 2026-09-30 | 018 | Phases 3–8, including advisor clean-up |
| 2026-09-30 | 019 | Phase 9: talent contract step (backup in `archive.talent_private_columns_019`), sign-in audit, and `rls_auto_enable` execute revoke. The legacy-media dry run found 0 legacy photos, so nothing needed moving. |

## Rollback

- **App:** promote the previous Vercel deployment.
- **Database:**
  - Migrations are additive unless noted. Roll forward with a fix migration.
  - **019** dropped the old private columns on `talent`. Their values are in `archive.talent_private_columns_019` (and in `talent_private_details`). To restore, re-add the columns and copy the values back from the archive table.
  - Restore the platform backup only if data was damaged (see `operations.md`).
