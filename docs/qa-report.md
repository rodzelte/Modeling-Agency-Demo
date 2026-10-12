# QA report — release candidate v1.0.0-rc.1

_Date: 2026-09-30. Scope: roadmap Phases 9–17 (all on `main` and deployed since 2026-10-01)._

## Automated results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | ✅ clean |
| Lint (`eslint`) | ✅ clean |
| Production build | ✅ |
| Database, RLS and migration replay (PGlite, migrations 001–025) | ✅ 209 tests: 173 database, 32 unit, 4 acceptance |
| Schema-wide security rules (`tests/rls/hardening`) | ✅ |
| Browser tests, desktop and mobile (Playwright) | ✅ 64 passed; 2 signed-in checks skipped (need `E2E_EMAIL`/`E2E_PASSWORD`) |
| Browser tests against the production build (CSP enforced) | ✅ no CSP violations; pages hydrate |
| Accessibility (axe, WCAG 2.2 A/AA), 7 public pages × desktop and mobile | ✅ 14/14 after fixes (below) |
| Dependency audit (`npm audit --omit=dev`) | ✅ 0 vulnerabilities |

## Lighthouse (production build, simulated mobile, local server with remote Supabase)

| Page | Performance | Accessibility | Best practices | SEO | LCP |
|---|---|---|---|---|---|
| `/` | 97 | 100 | 100 | 100 | 2.7 s |
| `/models` | 94 | 100 | 93 | 100 | 3.0 s |
| `/login` | 95 | 100 | 96 | 63* | 2.9 s |

\* `/login` is deliberately excluded from search engines (robots), which Lighthouse scores as an SEO failure.

- **Load time:** LCP of 2.7–3.0 s is measured locally with simulated slow 4G against a remote database. Production on Vercel's edge, with cached public data, should come in under the 2.5 s target. Re-measure on the live domain (launch checklist).
- **Small text:** the best-practices deduction on `/models` is for "legible font sizes". The brand's small uppercase labels (10–11 px) fall below Lighthouse's 12 px mobile guideline. This is a design decision for the owner; everything still meets WCAG contrast.

## Fixed during QA

| Issue | Fix |
|---|---|
| Grey and terracotta text below WCAG 4.5:1 contrast (public site, sign-in, dashboard) | Darkened site-wide: `#8d8f88`→`#6b6d66`, `#a2a39d`/`#b5b6b0`→`#717369`, `#c26a48`→`#a4502f`, public `--muted` → `#66635c`, sidebar and footer white opacity raised |
| Decorative "42" in the About image placeholder counted as low-contrast text | Replaced with the paper-grid pattern |
| Roster and board pages skipped from h1 to h3 | Added visually hidden h2 headings |
| Canonical URLs were relative (invalid) | `metadataBase` from `NEXT_PUBLIC_SITE_URL` in the root layout |

Earlier phases also found and fixed the following during their own tests:
- anon default grants (S8);
- talent reading staff notes (S9);
- protocol-relative redirect targets (S10);
- a double-booking check that ignored appointments;
- a shoe-size type mismatch in change requests.

## Not yet verified (needs the migrations applied and real accounts)

Migrations 019–025 are now applied and the release is deployed, so these can be checked with real accounts. See the launch checklist.

1. Every dashboard module with real data:
   - applications from a real GHL submission
   - the CMS publish flow
   - bookings, calendar and finance
   - packages and a shared link
   - comp card PDF with real photos
   - portal invitation and magic link
   - MFA setup for owner and administrator
2. Supabase Storage behaviour for real uploads, copies, signed URLs and deletions. PGlite only models the RLS on `storage.objects`.
3. Email delivery (reset, magic link) through custom SMTP.
4. Performance and CSP on the production HTTPS domain.
5. A manual screen-reader pass (VoiceOver on iOS, NVDA on Windows) and a keyboard-only pass of the dashboard.
6. Browsers not covered by automation: Safari on iOS/macOS, Firefox, Edge.

## Phase 18: GHL sync, production verification (2026-10-01)

Migration 026 applied. First reconciliation run on production, triggered through `/api/integrations/ghl/sync` with `CRON_SECRET`.

| Check | Result |
|---|---|
| Contacts and opportunities mirrored | 374 / 374 contacts, 260 / 260 opportunities, 6 pipelines, 121 fields |
| Talent records | 49 linked or created: 27 active, 22 enrolled. All are private drafts. The existing published talent is unchanged. |
| Program tags | "Talent Recruitment" 47, "Model Expo" 10 (8 people have both) |
| Join Us applications | All 27 marked converted and linked to the same talent; none duplicated |
| Duplicate people | None. Talent names are unique; `ghl_contacts.talent_id` is unique. |
| Photos | 126 stored: headshot 29, 3/4 25, full body 27, gallery 45. Duplicates: 0 by GHL file ID, 0 by content. The 2 photos over 15 MB were stored after the cap was raised to 30 MB. |
| Second run (idempotency) | 0 new talent, measurements, social accounts, addresses, history rows or opportunity changes |
| Sample comparison, GHL vs Supabase (4 models: Expo only, both programs, active, enrolled) | Name, email, phone, date of birth, gender, height/bust/waist/hips (converted to cm), hair, Instagram/TikTok, CRM status, tags and photo count all match |
| Blank values | Missing GHL values stay blank (e.g. eye colour). Values typed as "N/A" in GHL are kept as typed in text fields and become blank in numeric fields. |
| Public site | Anonymous view still shows only the 1 published talent. Anonymous read of `ghl_contacts` is refused (42501). |
| Conflicts / failed jobs | 0 / 0 |

Data-quality notes found in GHL (left as GHL has them, not "fixed"):
- One adult's height is typed as "50" and is read as 50 in, which is 127 cm. Check it in GHL.
- One talent's date of birth in GHL is 2026-02-18.

Not yet verified:
- **Dashboard display:** requires a staff login.
- **Live GHL webhook:** requires the "Sync to 42 Agency OS" workflow in GHL.
- **Write-back:** off until tested on a test contact.
