# Modeling Agency Demo

A complete management system for a model and talent agency: a public website, a staff dashboard and a talent portal. Designed and developed by **Rodzel Te**.

This repository runs as a self-contained **demo**: every screen and workflow works, on fictional sample data, with no database or account to set up.

- Developer: Rodzel Te ([@rodzelte](https://github.com/rodzelte))
- Contact: zythonix.te@gmail.com

## What it does

| Area | Features |
|---|---|
| Public website | Editorial home page, searchable roster with board pages (Women, Men, Teens and sub-boards), talent profiles with portfolios and digitals, CMS pages, redirects |
| Talent | Profiles with 16 record tabs (measurements, contacts, addresses, rates, legal, banking, medical, documents, notes and more), boards, publication workflow, privacy rules for minors |
| Media | Private uploads, publish to the website, portfolios, digital books, PDF comp cards |
| Operations | Companies and contacts, bookings with double-booking warnings, calendar, tasks, fees, commission and invoices, CSV and calendar exports |
| Sales | Client packages with expiring, revocable share links |
| Applications | Review queue, notes, convert an applicant into a talent record |
| Talent portal | Talent see their profile, bookings and documents, upload digitals, set availability and request changes for staff to approve |
| Administration | Roles and a permission matrix, team access, audit log, memberships, CRM sync and data import screens |

Permissions are enforced in the database (Postgres row-level security), then again in the API and the pages.

## Try the demo

```bash
npm install
```

```bash
npm run demo
```

Open http://localhost:3000/demo. It signs you in as the sample agency owner. No `.env` file is needed.

| Link | Opens as |
|---|---|
| `/demo` | Owner: everything |
| `/demo?as=booker` | Booker: bookings, calendar, clients, packages |
| `/demo?as=talent_manager` | Talent manager: talent, applications, requests |
| `/demo?as=accounting` | Accounting: finance |
| `/demo?as=read_only` | Read only: can look, cannot change |
| `/demo?as=talent` | A signed model's own portal |
| `/` | The public website |

The sign-in page lists every sample account. A "Demo mode" bar on each page has **Reset demo data**, which restores the original sample records; the demo also resets itself after an hour without activity.

For presenting, use the faster production build:

```bash
npm run demo:build
```

```bash
npm run demo:start
```

### How the demo is isolated

Demo mode replaces the database, sign-in and file storage with an in-memory sandbox inside the web server (PGlite, a Postgres that runs in-process, loading the real schema from `supabase/migrations`). The sample data in `supabase/demo/seed.sql` is fictional. A demo server holds no credentials, refuses every outbound request, sends no email, and accepts no inbound integration calls. Details: [docs/demo-mode.md](docs/demo-mode.md).

## Put the demo online

**Vercel.** Import this repository as a new project, add the environment variable `NEXT_PUBLIC_DEMO_MODE` = `true` (nothing else), deploy, and share `https://<project>.vercel.app/demo`. On Vercel the data lives in one serverless function: it returns to the original sample data whenever Vercel recycles that function (after some minutes without visitors), and the first page after a quiet spell takes several seconds.

**A container host** (Railway, Render, Fly.io) keeps the data until you reset it. `railway.json` and `Dockerfile.demo` are included: deploy the repository, add no variables, generate a domain. It needs about 2 GB of memory.

Details and limits: [docs/demo-mode.md](docs/demo-mode.md).

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS 4
- Postgres with row-level security, database views and functions (Supabase in a live installation; PGlite in the demo)
- Zod validation on every write
- Node.js 20.9 or newer

## Running a live installation

With a Supabase project of your own, the same code runs as a real system:

```bash
npm install
copy .env.example .env.local
npm run dev
```

Set these values in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
SUPABASE_SECRET_KEY=<server-only-secret-key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Apply the schema with `npx supabase@latest link --project-ref <your-project-ref>` and `npx supabase@latest db push`. Keep `SUPABASE_SECRET_KEY` server-only: never prefix it with `NEXT_PUBLIC_` or commit it. Access to the dashboard comes only from the `agency_members` table, which the database binds to a signed-in user once their email is confirmed.

## Quality checks

```bash
npm run lint
npx tsc --noEmit
npm test            # database rules, unit tests and the demo sandbox (in-memory Postgres)
npm run build
```

With a demo running on port 3100 (`npm run demo:start -- --port 3100`), `npm run demo:check` drives every module end to end: pages, create/edit/delete, publishing, exports, roles, the portal and reset.

## Documentation

- [Demo mode](docs/demo-mode.md)
- [Architecture](docs/architecture.md)
- [Database notes](docs/database.md)
- [Permissions](docs/permissions.md)

## Author

Rodzel Te · [github.com/rodzelte](https://github.com/rodzelte) · zythonix.te@gmail.com

All rights reserved. This repository is shared for demonstration.
