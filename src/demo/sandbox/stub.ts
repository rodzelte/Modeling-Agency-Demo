// Stand-ins for the parts of Supabase the migrations expect to exist: the API
// roles, the auth and storage schemas, and the default grants. Same shape as
// tests/rls/harness.mjs, plus the columns the sandbox's Auth and Storage
// emulation need (passwords, app metadata, object metadata).
export const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema storage;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    encrypted_password text,
    email_confirmed_at timestamptz,
    last_sign_in_at timestamptz,
    raw_app_meta_data jsonb not null default '{"provider":"email","providers":["email"]}'::jsonb,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index users_email_key on auth.users (lower(email));

  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt()->>'sub', '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(auth.jwt()->>'role', ''), 'anon')
  $$;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id), name text, owner uuid,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant all on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated, service_role;

  -- Supabase grants API roles full table privileges in public; RLS is the boundary.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

// Buckets the app uses. Migrations create or configure most of them; any that
// were created by hand in the real project are added here so uploads work.
export const BUCKETS_STUB = `
  insert into storage.buckets (id, name, public) values
    ('talent-public', 'talent-public', true),
    ('talent-private', 'talent-private', false),
    ('talent-documents', 'talent-documents', false),
    ('applications', 'applications', false),
    ('cms-media', 'cms-media', true),
    ('team-avatars', 'team-avatars', true)
  on conflict (id) do nothing;
`;
