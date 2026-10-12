// Runs the real supabase/migrations against an in-memory Postgres (PGlite) with a
// minimal stand-in for Supabase's auth/storage schemas, roles, and default grants.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationsDir = join(import.meta.dirname, "..", "..", "supabase", "migrations");

const supabaseStub = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema storage;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    email_confirmed_at timestamptz,
    last_sign_in_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt()->>'sub', '')::uuid
  $$;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id), name text, owner uuid,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  grant all on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated, service_role;

  -- Supabase grants API roles full table privileges in public; RLS is the boundary.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export const ids = {
  owner: "00000000-0000-0000-0000-000000000001",
  readOnly: "00000000-0000-0000-0000-000000000002",
  creative: "00000000-0000-0000-0000-000000000003",
  accounting: "00000000-0000-0000-0000-000000000004",
  talentManager: "00000000-0000-0000-0000-000000000005",
  outsider: "00000000-0000-0000-0000-000000000006",
  lateInvitee: "00000000-0000-0000-0000-000000000007",
  unconfirmed: "00000000-0000-0000-0000-000000000008",
  publishedTalent: "10000000-0000-0000-0000-000000000001",
  draftTalent: "10000000-0000-0000-0000-000000000002",
};

export const users = {
  owner: { id: ids.owner, email: "owner@example.test" },
  readOnly: { id: ids.readOnly, email: "readonly@example.test" },
  creative: { id: ids.creative, email: "creative@example.test" },
  accounting: { id: ids.accounting, email: "accounting@example.test" },
  talentManager: { id: ids.talentManager, email: "manager@example.test" },
  outsider: { id: ids.outsider, email: "outsider@example.test" },
  lateInvitee: { id: ids.lateInvitee, email: "late@example.test" },
  unconfirmed: { id: ids.unconfirmed, email: "unconfirmed@example.test" },
};

function migrationFiles(upto) {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort()
    .filter((name) => Number.parseInt(name, 10) <= upto);
}

// State that exists in production before 009: members, talent, media, and a
// self-escalation already performed through the pre-009 profile policy.
async function seedLegacyState(db) {
  await db.exec(`
    insert into public.agency_members (email, full_name, role, status) values
      ('owner@example.test', 'Owner', 'owner', 'active'),
      ('readonly@example.test', 'Read Only', 'read_only', 'active'),
      ('creative@example.test', 'Creative', 'creative', 'active'),
      ('accounting@example.test', 'Accounting', 'accounting', 'active'),
      ('manager@example.test', 'Manager', 'talent_manager', 'active'),
      ('unconfirmed@example.test', 'Unconfirmed', 'booker', 'active');

    insert into auth.users (id, email, email_confirmed_at) values
      ('${ids.owner}', 'owner@example.test', now()),
      ('${ids.readOnly}', 'readonly@example.test', now()),
      ('${ids.creative}', 'creative@example.test', now()),
      ('${ids.accounting}', 'accounting@example.test', now()),
      ('${ids.talentManager}', 'manager@example.test', now()),
      ('${ids.outsider}', 'outsider@example.test', now()),
      ('${ids.lateInvitee}', 'late@example.test', now());

    insert into public.talent (id, slug, first_name, last_name, display_name, date_of_birth, publication_status, show_on_website, is_minor)
    values
      ('${ids.publishedTalent}', 'saih-test', 'Saih', 'Legalname', 'Saih', '2011-04-02', 'published', true, true),
      ('${ids.draftTalent}', 'draft-test', 'Draft', 'Person', 'Draft Person', '2000-01-01', 'draft', false, false);
    insert into public.talent_board_assignments (talent_id, board_id)
      select t.id, b.id from public.talent t, public.boards b where b.slug = 'teens-boys';

    insert into public.talent_banking (talent_id, account_name, account_number, routing_number)
      values ('${ids.publishedTalent}', 'Fictional', '000123456789', '000000001');
    insert into public.talent_medical (talent_id, doctor) values ('${ids.publishedTalent}', 'Dr Fictional');

    insert into public.talent_photos (talent_id, storage_path, "public", display_order) values
      ('${ids.publishedTalent}', 'talent/${ids.publishedTalent}/approved.jpg', true, 1),
      ('${ids.publishedTalent}', 'talent/${ids.publishedTalent}/internal-digital.jpg', false, 2);
    insert into storage.objects (bucket_id, name) values
      ('talent-public', 'talent/${ids.publishedTalent}/approved.jpg'),
      ('talent-public', 'talent/${ids.publishedTalent}/internal-digital.jpg');

    insert into public.audit_log (table_name, action, new_data)
      values ('talent', 'update', '{"date_of_birth":"2011-04-02","mobile":"555-0100"}');
  `);

  // The S1 exploit, as it works before 009: an unapproved Google user rewrites
  // their own profile to impersonate the owner.
  await as(db, users.outsider, `update public.profiles set email = 'owner@example.test', role = 'owner', status = 'active' where id = '${ids.outsider}'`);
}

export async function createDatabase({ upto = Number.POSITIVE_INFINITY } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(supabaseStub);
  const files = migrationFiles(upto);
  for (const file of files) {
    const number = Number.parseInt(file, 10);
    if (number === 9) await seedLegacyState(db);
    await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  if (!files.some((file) => Number.parseInt(file, 10) >= 9)) await seedLegacyState(db);
  return db;
}

// Adds an approved member after all migrations: a confirmed Auth user plus an
// agency_members row, which the database binds together.
export async function addMember(db, user, role, talentId = null) {
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [user.id, user.email]);
  await db.query(
    "insert into public.agency_members (email, full_name, role, status, talent_id) values ($1, $2, $3, 'active', $4)",
    [user.email, user.email, role, talentId],
  );
  return user;
}

let generatedUsers = 0;
export function newUser(label) {
  generatedUsers += 1;
  const suffix = generatedUsers.toString(16).padStart(12, "0");
  return { id: `20000000-0000-0000-0000-${suffix}`, email: `${label}-${generatedUsers}@example.test` };
}

// Runs one statement the way PostgREST would for this caller: inside a transaction,
// as the anon/authenticated role, with the caller's JWT claims.
export async function as(db, user, sql, params = []) {
  return db.transaction(async (tx) => {
    const claims = user === "anon" ? "" : JSON.stringify({ sub: user.id, email: user.email, role: "authenticated" });
    await tx.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    await tx.exec(user === "anon" ? "set local role anon" : "set local role authenticated");
    return tx.query(sql, params);
  });
}

// Returns the rows, or [] when the statement is rejected outright.
export async function rowsAs(db, user, sql, params = []) {
  try {
    return (await as(db, user, sql, params)).rows;
  } catch {
    return [];
  }
}

export async function rejects(db, user, sql, params = []) {
  try {
    await as(db, user, sql, params);
    return false;
  } catch {
    return true;
  }
}
