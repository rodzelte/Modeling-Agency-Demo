-- Production talent details, structured private modules, and measurement history.
alter table public.talent
  add column if not exists birth_place text,
  add column if not exists nationality text,
  add column if not exists mobile text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists email text,
  add column if not exists is_minor boolean not null default false,
  add column if not exists allow_sms boolean not null default false,
  add column if not exists email_icalendar text,
  add column if not exists username text,
  add column if not exists talent_login_enabled boolean not null default false,
  add column if not exists talent_app_enabled boolean not null default false,
  add column if not exists minimum_tariff numeric,
  add column if not exists minimum_hourly_rate numeric,
  add column if not exists minimum_day_rate numeric,
  add column if not exists public_bio text;

alter table public.talent_measurements
  add column if not exists weight_kg numeric,
  add column if not exists head_cm numeric,
  add column if not exists collar_cm numeric,
  add column if not exists hair_length text,
  add column if not exists hair_type text,
  add column if not exists body_type text,
  add column if not exists ethnicity text,
  add column if not exists suit_size text,
  add column if not exists suit_length text,
  add column if not exists shoe_size_custom text,
  add column if not exists gloves text,
  add column if not exists inseam_cm numeric,
  add column if not exists outseam_cm numeric,
  add column if not exists sleeve_cm numeric;

create table if not exists public.talent_addresses (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  label text not null default 'Main',
  address_1 text,
  address_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  phone text,
  mobile text,
  is_main boolean not null default false,
  is_billing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.talent_contacts (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  name text not null,
  relationship text,
  email text,
  phone text,
  mobile text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.talent_social_accounts (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  platform text not null,
  handle text,
  url text,
  follower_count integer,
  updated_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.talent_skills (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  category text not null,
  skill text not null,
  level text,
  notes text,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.talent_notes (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  note_type text not null default 'internal',
  body text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists talent_addresses_talent_idx on public.talent_addresses (talent_id);
create index if not exists talent_contacts_talent_idx on public.talent_contacts (talent_id);
create index if not exists talent_social_accounts_talent_idx on public.talent_social_accounts (talent_id);
create index if not exists talent_skills_talent_idx on public.talent_skills (talent_id, category, skill);
create index if not exists talent_notes_talent_idx on public.talent_notes (talent_id, created_at desc);

alter table public.talent_addresses enable row level security;
alter table public.talent_contacts enable row level security;
alter table public.talent_social_accounts enable row level security;
alter table public.talent_skills enable row level security;
alter table public.talent_notes enable row level security;

drop policy if exists "agency staff manage talent addresses" on public.talent_addresses;
create policy "agency staff manage talent addresses" on public.talent_addresses for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager']))
  with check (public.has_any_role(array['owner','administrator','talent_manager']));

drop policy if exists "agency staff manage talent contacts" on public.talent_contacts;
create policy "agency staff manage talent contacts" on public.talent_contacts for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager']))
  with check (public.has_any_role(array['owner','administrator','talent_manager']));

drop policy if exists "agency staff manage talent social accounts" on public.talent_social_accounts;
create policy "agency staff manage talent social accounts" on public.talent_social_accounts for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager','creative']))
  with check (public.has_any_role(array['owner','administrator','talent_manager','creative']));

drop policy if exists "agency staff manage talent skills" on public.talent_skills;
create policy "agency staff manage talent skills" on public.talent_skills for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager','creative']))
  with check (public.has_any_role(array['owner','administrator','talent_manager','creative']));

drop policy if exists "agency staff manage talent notes" on public.talent_notes;
create policy "agency staff manage talent notes" on public.talent_notes for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager','booker']))
  with check (public.has_any_role(array['owner','administrator','talent_manager','booker']));
