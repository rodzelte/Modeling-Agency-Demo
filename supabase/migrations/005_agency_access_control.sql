-- Agency access allowlist, profile synchronization, and owner-managed roles.
create table if not exists public.agency_members (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null default '',
  role text not null default 'staff',
  status text not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_members_role_check check (role in ('owner', 'administrator', 'staff', 'booker', 'talent_manager', 'creative', 'accounting', 'talent', 'read_only')),
  constraint agency_members_status_check check (status in ('active', 'pending', 'suspended'))
);

create unique index if not exists agency_members_email_lower_idx on public.agency_members (lower(email));
create index if not exists agency_members_status_idx on public.agency_members (status);

insert into public.roles (key, name) values ('staff', 'Staff') on conflict (key) do nothing;

create or replace function public.is_active_agency_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.agency_members am on lower(am.email) = lower(p.email)
    where p.id = auth.uid()
      and p.status = 'active'
      and am.status = 'active'
  );
$$;

create or replace function public.has_role(required_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.agency_members am on lower(am.email) = lower(p.email)
    where p.id = auth.uid()
      and am.status = 'active'
      and (
        am.role = required_role
        or p.role = required_role
        or exists (
          select 1 from public.profile_roles pr
          join public.roles r on r.id = pr.role_id
          where pr.profile_id = p.id and r.key = required_role
        )
      )
  );
$$;

create or replace function public.has_any_role(required_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.agency_members am on lower(am.email) = lower(p.email)
    where p.id = auth.uid()
      and am.status = 'active'
      and (
        am.role = any(required_roles)
        or lower(am.role) = any(select lower(value) from unnest(required_roles) value)
        or lower(p.role) = any(select lower(value) from unnest(required_roles) value)
        or lower(p.role) in ('admin', 'administrator')
        or exists (
          select 1 from public.profile_roles pr
          join public.roles r on r.id = pr.role_id
          where pr.profile_id = p.id and r.key = any(required_roles)
        )
      )
  );
$$;

alter table public.profiles enable row level security;
alter table public.profile_roles enable row level security;
alter table public.agency_members enable row level security;

drop policy if exists "agency users can view own profile" on public.profiles;
create policy "agency users can view own profile" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('owner'));

drop policy if exists "agency owners can manage profiles" on public.profiles;
create policy "agency owners can manage profiles" on public.profiles for all to authenticated
  using (id = auth.uid() or public.has_role('owner'))
  with check (id = auth.uid() or public.has_role('owner'));

drop policy if exists "agency owners can manage profile roles" on public.profile_roles;
create policy "agency owners can manage profile roles" on public.profile_roles for all to authenticated
  using (profile_id = auth.uid() or public.has_role('owner'))
  with check (profile_id = auth.uid() or public.has_role('owner'));

drop policy if exists "agency members can view own membership" on public.agency_members;
create policy "agency members can view own membership" on public.agency_members for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt()->>'email', '')) or public.has_role('owner'));

drop policy if exists "agency owners can manage memberships" on public.agency_members;
create policy "agency owners can manage memberships" on public.agency_members for all to authenticated
  using (public.has_role('owner'))
  with check (public.has_role('owner'));

create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  invited_member public.agency_members%rowtype;
  detected_name text;
begin
  select * into invited_member
  from public.agency_members
  where lower(email) = lower(coalesce(new.email, ''))
  limit 1;

  detected_name := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    ''
  );

  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(nullif(invited_member.full_name, ''), detected_name),
    coalesce(invited_member.role, 'read_only'),
    coalesce(invited_member.status, 'pending')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end,
    role = case when invited_member.id is not null then invited_member.role else public.profiles.role end,
    status = case when invited_member.id is not null then invited_member.status else public.profiles.status end,
    updated_at = now();

  insert into public.profile_roles (profile_id, role_id)
  select new.id, r.id
  from public.roles r
  where r.key = coalesce(invited_member.role, 'read_only')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_profile();

drop policy if exists "agency staff view talent" on public.talent;
create policy "agency staff view talent" on public.talent for select to authenticated
  using (public.has_any_role(array['owner','administrator','staff','booker','talent_manager','creative','accounting','read_only']));

drop policy if exists "agency staff view assignments" on public.talent_board_assignments;
create policy "agency staff view assignments" on public.talent_board_assignments for select to authenticated
  using (public.has_any_role(array['owner','administrator','staff','booker','talent_manager','creative','accounting','read_only']));

drop policy if exists "agency staff view measurements" on public.talent_measurements;
create policy "agency staff view measurements" on public.talent_measurements for select to authenticated
  using (public.has_any_role(array['owner','administrator','staff','booker','talent_manager','creative','accounting','read_only']));
