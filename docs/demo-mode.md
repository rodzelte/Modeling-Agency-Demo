# Demo Mode

A complete, clickable copy of the system for showing to prospective clients. Every screen, form and workflow behaves as it does in production, but the data is fictional and lives in an in-memory sandbox. A demo can never read or change the production database: it has no connection to it.

## How it works

| | Production | Demo mode |
|---|---|---|
| Database | Supabase project `dvpockrupiovuxcenuiy` | PGlite: a Postgres that runs inside the web server's own process and memory |
| Schema, RLS, triggers, views, functions | `supabase/migrations/*` | The same files, replayed at start-up, so permissions and rules behave identically |
| Data | Real | `supabase/demo/seed.sql` (fictional) plus generated placeholder images |
| Auth, Storage, PostgREST | Supabase services | Emulated in-process (`src/demo/sandbox/`) |
| Credentials | Supabase keys, GHL token, cron secret | None. They are blanked before the server starts and deleted again inside it |
| Outbound network | Supabase, GoHighLevel, alert webhook | Blocked. Every outbound request from the server is refused and logged |

`NEXT_PUBLIC_DEMO_MODE=true` switches it on at build time. `next.config.ts` always defines the flag as `"true"` or `"false"`, so:

- a production build contains no sandbox code, demo accounts or demo UI (checked: the string `pglite` does not occur in `.next/`);
- a demo build has no code path that reads the project URL or the secret key.

The two builds also live in different folders (`.next` and `.next-demo`), so one can never be served as the other.

### Layers that keep a demo away from production

1. **No address.** In demo mode `getSupabasePublicEnv()` returns `http://sandbox.demo.invalid` (a name that cannot resolve) before any environment variable is read, and every Supabase client is given a `fetch` that answers from the sandbox in-process.
2. **No credentials.** `scripts/demo.mjs` blanks every real-service setting (anything named `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `GHL_*`, `CRON_SECRET`, `ERROR_ALERT_WEBHOOK_URL`, database, mail and payment settings), including those in `.env.local`. `src/demo/boot.ts` deletes them again inside the server.
3. **No way out.** `src/demo/boot.ts` replaces the server's global `fetch`: only the sandbox and the machine's own addresses are reachable. GoHighLevel calls are answered by a stand-in (`src/demo/integrations/ghl.ts`); nothing is emailed.
4. **No way in.** The GHL webhooks and the scheduled sync endpoint answer 404. The browser reaches the sandbox only through `/api/demo/supabase/*`, which never accepts the service role.
5. **Tests.** `tests/unit/demo-boundaries.test.mts` fails if any of the above is weakened.

## Start it

```bash
npm run demo
```

Opens on http://localhost:3000 (add `-- --port 3100` for another port). The first start takes about 10 seconds while the sandbox is built.

For a faster, production-like server (use this when presenting):

```bash
npm run demo:build
```

```bash
npm run demo:start
```

No `.env` file is needed. If one exists, its production values are ignored and the launcher prints which ones.

## Sign in

Open `/login` and choose a demo account, or use a direct link:

| Link | Opens as |
|---|---|
| `/demo` | Owner (Olivia Hart): everything |
| `/demo?as=administrator` | Administrator |
| `/demo?as=booker` | Booker: bookings, calendar, clients, packages |
| `/demo?as=talent_manager` | Talent manager: talent, applications, requests |
| `/demo?as=creative` | Creative: media and website |
| `/demo?as=accounting` | Accounting: finance |
| `/demo?as=read_only` | Read only: can look, cannot change |
| `/demo?as=talent` | A signed model's own portal |

The ordinary sign-in form works too: any sample address with the password `demo-access-42` (shown on the sign-in page). The accounts are defined in `src/demo/accounts.ts`.

Every page shows a "Demo mode" bar with **Reset demo data** and **Switch account**.

## Share it with a prospect

One sandbox serves everyone who opens the demo, so two prospects using it at the same moment see each other's changes. Reset between presentations.

1. **Present from your own computer.** Run `npm run demo:build` then `npm run demo:start` and share your screen.
2. **Let a prospect click through it themselves, for a call.** Start it as above and expose the port with a tunnel (for example Cloudflare Tunnel or ngrok). Send them `https://<tunnel-address>/demo`. Images and links work on any address without configuration.
3. **Keep a demo online.** Two ways, described under "Put it online" below: Vercel (free, best effort) or a container host such as Railway (steady).

The demo sends `noindex` headers and a disallow-all `robots.txt`. It has no access code of its own; anyone with the address can open it (and can only ever see sample data).

## Put it online

### Vercel (best effort)

1. At vercel.com choose **Add New → Project** and import the repository.
2. Under **Environment Variables** add `NEXT_PUBLIC_DEMO_MODE` with the value `true`. Add nothing else.
3. Deploy, then open `https://<project>.vercel.app/demo`. Use the production address, not a preview deployment's.

How it works there: Vercel runs an app as several functions that share no memory. In demo mode exactly one of them (the route `/api/demo/supabase/*`) holds the sandbox, and all other server code reaches it over the site's own address (`src/demo/remote.ts`). What that means in practice:

- **Changes last only while Vercel keeps that function alive.** After some minutes without visitors Vercel recycles it and the demo starts again from the original sample data. Signed-in sample accounts stay signed in.
- **The first page after a quiet spell is slow** (several seconds) while the sandbox starts.
- **Vercel may run two copies of the function under load**, each with its own data; a record can then seem to come and go. The app sends requests a few at a time to avoid this. `/api/demo/status` shows `sandbox.instance`: if it changes between refreshes, more than one copy is running.
- Uploads larger than about 4 MB are refused by Vercel.
- Times are shown in UTC.

Good for letting a prospect look around. For a presentation where every change must stay put, use a container host or your own machine.

### A container host (steady)

One long-running server keeps the data until you reset it. The repository carries `railway.json` and `Dockerfile.demo`:

1. At railway.com choose **New Project → Deploy from GitHub repo** and pick the repository.
2. Add no variables. Wait for the build and the health check.
3. Open the service's **Settings → Networking → Generate Domain** and keep the port Railway suggests. If it suggests none, add the variable `PORT=3000`, redeploy, and enter 3000.

The server needs about 1 GB of memory in use and up to 2 GB during a reset. Any host that runs one Node process works the same way: build with `npm ci && npm run demo:build`, start with `npm run demo:start -- --hostname 0.0.0.0` (it listens on `$PORT`), no environment variables.

## Reset the data

- **Reset demo data** in the demo bar (any page).
- Automatically: a demo that was changed and then left untouched for 60 minutes is reset before the next visitor's first click, so each prospect starts clean. Set `DEMO_IDLE_RESET_MINUTES` to change the wait, or `0` to switch it off (do that for a long live presentation with pauses).
- Restarting the server also starts from the original sample data (on Vercel this happens by itself; see above).

A reset takes about half a second and discards everything added, edited, deleted or uploaded since the server started. Sample accounts stay signed in. Dates in the sample data are relative to "now"; a reset more than 12 hours after start-up rebuilds them so upcoming bookings stay upcoming.

## Go back to production

Nothing needs undoing. Demo mode exists only in processes started through `npm run demo*`:

```bash
npm run dev
```

and `npm run build` / `npm run start` work exactly as before and use `.env.local` and the production project. A production Vercel project is untouched as long as `NEXT_PUBLIC_DEMO_MODE` is never set on it.

## What is real and what is simulated

| Feature | In the demo |
|---|---|
| Talent, boards, media, the 16 record tabs, bookings, finance, tasks, companies, packages, applications, CMS, memberships, team, permissions, audit log, portal | Real code and real database rules, on sample data. Create, edit, delete, publish, upload, export (CSV, .ics, PDF comp card) all work |
| File uploads | Stored in server memory with the real storage policies; gone after a reset |
| Sign-in | Sample accounts; password changes work |
| Emails (confirmation, password reset, portal sign-in link, emailed codes) | Not sent. Requests succeed; a new teammate's account is confirmed immediately. Where a 6-digit emailed code is asked for, `424242` is accepted |
| Two-step sign-in, Google sign-in, authenticator apps | Off (there is no inbox or Google account behind a sample person) |
| GHL Sync | The real sync engine runs against a stand-in GoHighLevel built from the sample CRM data. "Run sync now" completes and brings in one new sample lead each time. Write-back is acknowledged and sent nowhere |
| GHL webhooks, scheduled sync | Off (404) |
| CDS Import | Staged sample data is preloaded; "Add new talents" works. The CDS and WebForFashion windows are not opened |
| "Join us" | Explains the step at `/demo/join` instead of opening the real application form |
| Contact email on the public site | `hello@northlight-demo.example` |
| Error alert webhook | Off |
| Stripe | Not connected in production either |

## Check it yourself

| Command | What it proves |
|---|---|
| `npm run test:demo` | The sandbox through the real supabase-js client: sign-in, CRUD with joins, RLS denials, storage, reset; and that the test process made no network request |
| `npm run test:unit` | The guard rails in `tests/unit/demo-boundaries.test.mts` |
| `npm run demo:check` (with the demo running) | End to end over HTTP: every dashboard and portal page, create/edit/delete in every module, publish to the public site, exports, role enforcement, reset back to the starting row counts, and no outbound request attempted by the application |
| `GET /api/demo/status` | What the running server is connected to: no Supabase project, which real-service settings are present (none), and every outbound request it refused |

`npm run demo:check` uses port 3100 by default; set `BASE_URL` for another address. It refuses to run against a server that is not in demo mode.

## Change the sample data

- **Records:** `supabase/demo/seed.sql`. Fictional people only, `.example` email addresses, dates relative to `now()`. Check it with `node scripts/demo/check-seed.mts`.
- **Photos:** generated silhouettes by default, so no real person appears. To use your own licensed images, add them under `supabase/demo/photos/` (git-ignored):
  - `<talent-slug>/*.jpg` for one talent, in file-name order;
  - `_any/*.jpg` as a shared pool for everyone else;
  - `_site/*.jpg` for website banners and page images.
- **Accounts:** `src/demo/accounts.ts` (and the matching `agency_members` rows in the seed).

## Limits

- One shared sandbox per server; data is lost on restart. That is the point, but it is not a staging environment.
- The server uses about 700 MB of memory, and briefly more during a reset; give it 2 GB.
- The emulation covers the Supabase features this app uses (`src/demo/sandbox/rest.ts`, `auth.ts`, `storage.ts`). A new kind of query (for example a PostgREST operator not used before) needs support there; `npm run test:demo` and `npm run demo:check` show when something is missing.
- In development (`npm run demo`) the framework's own telemetry and update checks are also refused by the outbound block. This is harmless and appears in `/api/demo/status`.
