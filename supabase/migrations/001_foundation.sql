-- 42 Agency OS foundation, compatible with the existing agency schema.
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  role text not null default 'read_only',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profile_roles (
  profile_id uuid references public.profiles(id) on delete cascade,
  role_id uuid references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, role_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);

create or replace function public.has_role(required_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profile_roles pr join public.roles r on r.id = pr.role_id
    where pr.profile_id = auth.uid() and r.key = required_role
  ) or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and lower(p.role) in (lower(required_role), 'admin', 'administrator')
  );
$$;

create or replace function public.has_any_role(required_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profile_roles pr join public.roles r on r.id = pr.role_id
    where pr.profile_id = auth.uid() and r.key = any(required_roles)
  ) or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (lower(p.role) = any(select lower(value) from unnest(required_roles) value) or lower(p.role) in ('admin','administrator'))
  );
$$;

alter table public.roles enable row level security;
alter table public.profile_roles enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "agency admins can manage roles" on public.roles;
create policy "agency admins can manage roles" on public.roles for all to authenticated
  using (public.has_any_role(array['owner','administrator']))
  with check (public.has_any_role(array['owner','administrator']));

drop policy if exists "agency users can view own roles" on public.profile_roles;
create policy "agency users can view own roles" on public.profile_roles for select to authenticated
  using (profile_id = auth.uid() or public.has_any_role(array['owner','administrator']));

drop policy if exists "agency admins can view audit logs" on public.audit_logs;
create policy "agency admins can view audit logs" on public.audit_logs for select to authenticated
  using (public.has_any_role(array['owner','administrator','read_only']));

insert into public.roles (key, name) values
  ('owner', 'Owner'), ('administrator', 'Administrator'), ('booker', 'Booker'), ('talent_manager', 'Talent Manager'),
  ('creative', 'Creative / Photographer'), ('accounting', 'Accounting'), ('talent', 'Talent'), ('read_only', 'Read Only')
on conflict (key) do nothing;
