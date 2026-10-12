-- 014: Operational talent profile — measurements, skills, contacts, addresses, agencies.
--
-- talent_measurements is the measurement history (spec: talent_measurement_history):
-- rows are snapshots, never updated (011 revokes UPDATE). is_official distinguishes
-- official from current/true measurements; the latest of each is "current".
-- Free-text skills and agencies are backfilled into catalogues; text columns stay.

-- ---------------------------------------------------------------------------
-- Measurements
-- ---------------------------------------------------------------------------
alter table public.talent_measurements add column if not exists created_by uuid references auth.users(id) on delete set null;

create or replace function public.stamp_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists stamp_measurement_creator on public.talent_measurements;
create trigger stamp_measurement_creator before insert on public.talent_measurements
  for each row execute procedure public.stamp_created_by();

-- Latest official and latest current snapshot per talent, evaluated with the caller's RLS.
create or replace view public.talent_current_measurements with (security_invoker = true) as
select distinct on (talent_id, is_official) *
from public.talent_measurements
order by talent_id, is_official, measured_on desc, created_at desc;
revoke all on public.talent_current_measurements from anon;
grant select on public.talent_current_measurements to authenticated;

-- ---------------------------------------------------------------------------
-- Skills catalogue
-- ---------------------------------------------------------------------------
create table if not exists public.skill_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists skill_categories_name_idx on public.skill_categories (lower(name));

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.skill_categories(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists skills_category_name_idx on public.skills (category_id, lower(name));

insert into public.skill_categories (name, sort_order)
select name, position::int
from unnest(array['Acting','Runway','Dance','Singing','Sports','Swimming','Martial Arts','Languages','Musical Instruments'])
  with ordinality as s(name, position)
on conflict do nothing;

-- Categories already used by talent_skills rows.
insert into public.skill_categories (name, sort_order)
select distinct initcap(trim(ts.category)), 100
from public.talent_skills ts
where trim(coalesce(ts.category, '')) <> ''
on conflict do nothing;

alter table public.talent_skills
  add column if not exists category_id uuid references public.skill_categories(id) on delete set null,
  add column if not exists skill_id uuid references public.skills(id) on delete set null;

update public.talent_skills ts
set category_id = c.id
from public.skill_categories c
where ts.category_id is null and lower(trim(ts.category)) = lower(c.name);

insert into public.skills (category_id, name)
select distinct ts.category_id, initcap(trim(ts.skill))
from public.talent_skills ts
where ts.category_id is not null and trim(coalesce(ts.skill, '')) <> ''
on conflict do nothing;

update public.talent_skills ts
set skill_id = s.id
from public.skills s
where ts.skill_id is null and s.category_id = ts.category_id and lower(trim(ts.skill)) = lower(s.name);

create index if not exists talent_skills_skill_idx on public.talent_skills (skill_id);

alter table public.skill_categories enable row level security;
alter table public.skills enable row level security;
revoke all on public.skill_categories, public.skills from anon;

drop policy if exists "members read skill categories" on public.skill_categories;
create policy "members read skill categories" on public.skill_categories for select to authenticated using (public.is_active_agency_member());
drop policy if exists "skill editors manage skill categories" on public.skill_categories;
create policy "skill editors manage skill categories" on public.skill_categories for all to authenticated
  using (public.has_permission('skills.edit')) with check (public.has_permission('skills.edit'));

drop policy if exists "members read skills" on public.skills;
create policy "members read skills" on public.skills for select to authenticated using (public.is_active_agency_member());
drop policy if exists "skill editors manage skills" on public.skills;
create policy "skill editors manage skills" on public.skills for all to authenticated
  using (public.has_permission('skills.edit')) with check (public.has_permission('skills.edit'));

-- ---------------------------------------------------------------------------
-- Related contacts and addresses
-- ---------------------------------------------------------------------------
alter table public.talent_contacts drop constraint if exists talent_contacts_relationship_check;
alter table public.talent_contacts add constraint talent_contacts_relationship_check
  check (relationship is null or relationship in ('parent', 'guardian', 'manager', 'agent', 'emergency', 'other')) not valid;

alter table public.talent_addresses
  add column if not exists address_3 text,
  add column if not exists contact_name text,
  add column if not exists is_loan_out boolean not null default false,
  add column if not exists is_public boolean not null default false;

-- ---------------------------------------------------------------------------
-- Agencies
-- ---------------------------------------------------------------------------
create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text,
  city text,
  phone text,
  email text,
  website text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists agencies_name_idx on public.agencies (lower(name));

insert into public.agencies (name, country, city, phone)
select distinct on (lower(trim(agency_name))) trim(agency_name), country, city, phone
from public.talent_agencies
where trim(coalesce(agency_name, '')) <> ''
order by lower(trim(agency_name)), created_at
on conflict do nothing;

alter table public.talent_agencies
  add column if not exists agency_id uuid references public.agencies(id) on delete set null,
  add column if not exists assigned_on date,
  add column if not exists other_mother_agency text,
  add column if not exists notes text;

update public.talent_agencies ta
set agency_id = a.id
from public.agencies a
where ta.agency_id is null and lower(trim(ta.agency_name)) = lower(a.name);

create index if not exists talent_agencies_agency_idx on public.talent_agencies (agency_id);

alter table public.agencies enable row level security;
revoke all on public.agencies from anon;

drop policy if exists "staff read agencies" on public.agencies;
create policy "staff read agencies" on public.agencies for select to authenticated using (public.has_permission('talent.view'));
drop policy if exists "agency managers manage agencies" on public.agencies;
create policy "agency managers manage agencies" on public.agencies for all to authenticated
  using (public.has_permission('agencies.manage')) with check (public.has_permission('agencies.manage'));
