# Operations runbook

This runbook is for keeping production healthy. It includes the **one-time settings that only the owner can change** in the Supabase, Vercel and GitHub dashboards; nothing in this repo can change them.

## One-time setup (owner)

### 1. Supabase Auth email (custom SMTP) — required before real users

Supabase's built-in mailer sends only a few emails per hour, which breaks password resets and confirmations at real volume. Use the agency's sender instead:

1. **Supabase → Authentication → Emails → SMTP Settings → Enable custom SMTP:**

   | Field | Value |
   |---|---|
   | Sender email | `ghl@modelluxemedia.com` |
   | Sender name | `42 Model Management` |
   | Host, port, username, password | From the provider that hosts that mailbox |

   If it is a Google Workspace mailbox, use `smtp.gmail.com`, port 465, and an app password. If the mailbox sends through GoHighLevel's LeadConnector/Mailgun, use the SMTP credentials from GHL → Settings → Email Services.
2. **DNS for `modelluxemedia.com`:** SPF, DKIM and DMARC records must authorise that provider, or messages land in spam.
3. **Supabase → Authentication → Rate limits:** raise the "emails per hour" limit once SMTP works.
4. **Supabase → Authentication → Emails → Templates.** Point the links at `/auth/confirm`, so they work even when the email is opened on another device:

   | Template | Link |
   |---|---|
   | Reset password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/login/reset` |
   | Magic link | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/portal` |
   | Confirm signup | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/dashboard` |
   | Invite user | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/portal` |

### 2. Supabase Auth security

- **Authentication → Settings:**
  - Turn on **leaked-password protection**.
  - Keep **email confirmation** on. Membership binding trusts confirmed emails.
  - Set the minimum password length to 10.
- **Authentication → URL Configuration:**
  - Site URL: the production domain.
  - Redirect URLs: `https://<domain>/auth/callback` and `https://<domain>/auth/confirm`, plus the `http://localhost:3000` equivalents.
- **Authentication → Multi-Factor:** keep TOTP enabled (the default). Owner and administrator must set it up at `/login/mfa` the first time they sign in after this release.

### 3. Error alerts

- **Vercel → Project → Settings → Environment Variables:** set `ERROR_ALERT_WEBHOOK_URL` (Secret, Production) to a Slack or Discord incoming-webhook URL. Every server error then posts a one-line alert containing the path, error code and digest, never user data.
- **Uptime monitoring:** add a check on `https://<domain>/` and `https://<domain>/models`, for example with Better Stack or UptimeRobot, alerting the owner's phone.
- **Logs:** Vercel → Logs. Each server event is one JSON line (`level`, `scope`, `message`, `code`, `digest`). Search by the digest a user reports from an error page.

### 4. GitHub

- **Settings → Secrets and variables → Actions:**
  - Add the secrets `E2E_SUPABASE_URL` and `E2E_SUPABASE_PUBLISHABLE_KEY`, plus optionally `E2E_EMAIL` and `E2E_PASSWORD` for a `read_only` test member.
  - Set the variable `E2E_ENABLED=true`.
- **Dependabot:** it opens weekly update PRs (`.github/dependabot.yml`). Merge them only when CI is green.

## Backups and restore

- **What exists:** Supabase takes daily backups on paid plans. Free projects have **no downloadable backups**, so check the plan under Project Settings → Billing. Point-in-time recovery is a paid add-on. For a system that holds banking, legal and medical data, **the Pro plan with daily backups is the minimum** before launch.
- **Before every destructive migration:**
  1. Take a manual backup: `npx supabase db dump --linked -f backups/<date>-schema.sql` for the schema, and `--data-only` for data. Store it outside the repo; `backups/` is gitignored.
  2. The migration also archives affected data into the `archive` schema.
- **Storage:** database backups don't include Storage files. Keep media originals in `talent-private`, and avoid deleting objects except through the app's archive flows.
- **Restore drill (quarterly):** restore the latest backup into a local Postgres (`psql -f`), then check that the talent count and a sample profile match production. Record the date in `staging.md`.

## Incident response

1. **Site down or erroring:** check the Vercel status and logs. If the latest deployment is at fault, **promote the previous deployment** (Vercel → Deployments → ⋯ → Promote).
2. **Bad migration:**
   - Stop further pushes.
   - Write a fix migration (roll forward).
   - Restore from backup only if data was lost.
3. **Suspected data exposure:**
   - Rotate keys (see below).
   - Check `audit_logs` for `sensitive.viewed`, `document.downloaded`, `auth.login` and `auth.login_unapproved` around the time.
   - Suspend affected members in Settings → Team.
   - Assess notification duties (UK GDPR: within 72 hours).
4. **Owner locked out:** run the owner-recovery SQL in `README.md` in the Supabase SQL editor.
5. **Lost authenticator phone** (owner or administrator can't get past two-step sign-in):
   - Another owner or administrator removes the factor under Supabase → Authentication → Users → the user → MFA factors. The person sets MFA up again at next sign-in.
   - If nobody can sign in, set `MFA_REQUIRED_ROLES=none` in Vercel, redeploy, recover, then remove the variable and redeploy again.

## Key rotation

Rotate the keys before launch, after any suspected leak, and when a developer leaves:

1. **Supabase → Project Settings → API keys:** create new publishable and secret keys.
2. **Update Vercel:** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. Redeploy.
3. **Update** local `.env.local` files and the GitHub secrets.
4. **Revoke** the old keys in Supabase.
5. **Also rotate** the Google OAuth client secret and the GHL webhook secret (`GHL_WEBHOOK_SECRET`) if they may have leaked.
