-- Extend the existing agency tables without replacing them.
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'general',
  section text not null default 'main',
  name text not null,
  slug text unique not null,
  is_minor_board boolean not null default false,
  display_order integer not null default 0,
  is_active boolean not null default true,
  publish_to_website boolean not null default true,
  internal_only boolean not null default false,
  show_in_navigation boolean not null default true,
  sort_order integer not null default 0,
  description text,
  parent_board_id uuid references public.boards(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.talent (
  id uuid primary key default gen_random_uuid(),
  talent_id text unique,
  slug text unique not null,
  first_name text not null,
  last_name text not null,
  display_name text not null,
  location text,
  gender text,
  date_of_birth date,
  date_joined date,
  status text not null default 'active',
  publication_status text not null default 'draft',
  publish_to_website boolean not null default false,
  show_on_website boolean not null default false,
  show_in_search boolean not null default false,
  featured boolean not null default false,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.talent_board_assignments (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  board_order integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (talent_id, board_id)
);

create table if not exists public.talent_measurements (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  measured_on date not null default current_date,
  height_cm numeric,
  bust_chest_cm numeric,
  waist_cm numeric,
  hips_cm numeric,
  shoe_size_us text,
  hair_color text,
  eye_color text,
  is_official boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.talent_photos (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  storage_path text not null,
  title text,
  alt_text text,
  photographer text,
  image_type text not null default 'portfolio',
  is_cover boolean not null default false,
  portfolio_order integer not null default 0,
  display_order integer not null default 0,
  featured boolean not null default false,
  "public" boolean not null default false,
  publish_to_website boolean not null default false,
  focal_point jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.talent_private_details (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null unique references public.talent(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.boards add column if not exists parent_board_id uuid references public.boards(id) on delete set null;
alter table public.boards add column if not exists description text;
alter table public.boards add column if not exists internal_only boolean not null default false;
alter table public.boards add column if not exists publish_to_website boolean not null default true;
alter table public.boards add column if not exists show_in_navigation boolean not null default true;
alter table public.boards add column if not exists sort_order integer not null default 0;
update public.boards set sort_order = display_order where sort_order = 0 and display_order <> 0;

alter table public.talent add column if not exists talent_id text;
alter table public.talent add column if not exists location text;
alter table public.talent add column if not exists gender text;
alter table public.talent add column if not exists date_joined date;
alter table public.talent add column if not exists publication_status text not null default 'draft';
alter table public.talent add column if not exists show_on_website boolean not null default false;
alter table public.talent add column if not exists show_in_search boolean not null default false;
alter table public.talent add column if not exists featured boolean not null default false;
alter table public.talent alter column date_of_birth drop not null;
update public.talent set talent_id = id::text where talent_id is null;
update public.talent set show_on_website = publish_to_website where show_on_website = false and publish_to_website = true;
update public.talent set show_in_search = show_on_website where show_in_search = false and show_on_website = true;
update public.talent set publication_status = case when show_on_website then 'published' else 'draft' end where publication_status = 'draft' and show_on_website;

alter table public.talent_board_assignments add column if not exists sort_order integer not null default 0;
update public.talent_board_assignments set sort_order = board_order where sort_order = 0 and board_order <> 0;

alter table public.talent_photos add column if not exists title text;
alter table public.talent_photos add column if not exists alt_text text;
alter table public.talent_photos add column if not exists photographer text;
alter table public.talent_photos add column if not exists image_type text not null default 'portfolio';
alter table public.talent_photos add column if not exists display_order integer not null default 0;
alter table public.talent_photos add column if not exists featured boolean not null default false;
alter table public.talent_photos add column if not exists "public" boolean not null default false;
alter table public.talent_photos add column if not exists focal_point jsonb;
update public.talent_photos set "public" = publish_to_website where "public" = false and publish_to_website = true;
update public.talent_photos set featured = is_cover where featured = false and is_cover = true;
update public.talent_photos set display_order = portfolio_order where display_order = 0 and portfolio_order is not null;

alter table public.talent_measurements add column if not exists is_official boolean not null default false;
alter table public.talent_measurements add column if not exists notes text;

insert into public.boards (category, section, name, slug, is_minor_board, display_order, is_active, publish_to_website, internal_only, show_in_navigation, sort_order)
values
  ('women', 'fashion', 'Women / Fashion', 'fashion-women', false, 1, true, true, false, true, 1),
  ('men', 'development', 'Men / Development', 'development-men', false, 2, true, true, false, true, 2),
  ('women', 'development', 'Women / Development', 'development-women', false, 3, true, true, false, true, 3),
  ('women', 'curve', 'Women / Curve', 'curve-women', false, 4, true, true, false, true, 4),
  ('men', 'fashion', 'Men / Fashion', 'fashion-men', false, 5, true, true, false, true, 5),
  ('teens', 'boys', 'Teens / Boys', 'teens-boys', true, 6, true, true, false, true, 6)
on conflict (slug) do nothing;

create index if not exists talent_public_idx on public.talent (publication_status, show_on_website, show_in_search) where archived_at is null;
create index if not exists talent_board_assignments_board_idx on public.talent_board_assignments (board_id, sort_order);
create index if not exists talent_measurements_latest_idx on public.talent_measurements (talent_id, measured_on desc);
create index if not exists talent_photos_public_idx on public.talent_photos (talent_id, "public", display_order);

alter table public.boards enable row level security;
alter table public.talent enable row level security;
alter table public.talent_board_assignments enable row level security;
alter table public.talent_measurements enable row level security;
alter table public.talent_photos enable row level security;
alter table public.talent_private_details enable row level security;

drop policy if exists "agency public boards are readable" on public.boards;
create policy "agency public boards are readable" on public.boards for select to anon, authenticated
  using (is_active and publish_to_website and not internal_only);
drop policy if exists "agency staff manage boards" on public.boards;
create policy "agency staff manage boards" on public.boards for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager']))
  with check (public.has_any_role(array['owner','administrator','talent_manager']));

drop policy if exists "agency staff view talent" on public.talent;
create policy "agency staff view talent" on public.talent for select to authenticated
  using (public.has_any_role(array['owner','administrator','booker','talent_manager','creative','accounting','read_only']));
drop policy if exists "agency managers manage talent" on public.talent;
create policy "agency managers manage talent" on public.talent for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager']))
  with check (public.has_any_role(array['owner','administrator','talent_manager']));

drop policy if exists "agency staff manage assignments" on public.talent_board_assignments;
create policy "agency staff manage assignments" on public.talent_board_assignments for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager','booker']))
  with check (public.has_any_role(array['owner','administrator','talent_manager','booker']));

drop policy if exists "agency staff view measurements" on public.talent_measurements;
create policy "agency staff view measurements" on public.talent_measurements for select to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager','booker','creative','read_only']));
drop policy if exists "agency managers manage measurements" on public.talent_measurements;
create policy "agency managers manage measurements" on public.talent_measurements for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager']))
  with check (public.has_any_role(array['owner','administrator','talent_manager']));

drop policy if exists "agency staff manage media" on public.talent_photos;
create policy "agency staff manage media" on public.talent_photos for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager','creative']))
  with check (public.has_any_role(array['owner','administrator','talent_manager','creative']));

drop policy if exists "agency authorized staff view private details" on public.talent_private_details;
create policy "agency authorized staff view private details" on public.talent_private_details for select to authenticated
  using (public.has_any_role(array['owner','administrator','accounting']));
