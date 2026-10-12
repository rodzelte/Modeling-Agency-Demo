-- 015: Media system — photo metadata, ordering, featured image, videos, portfolios,
-- digital books.
--
-- talent_photos is the spec's talent_images. Originals live in talent-private;
-- only promoted copies (public_storage_path) in talent-public are ever served.

alter table public.talent_photos
  add column if not exists type_of_work text,
  add column if not exists support_name text,
  add column if not exists country_of_publication text,
  add column if not exists original_file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists stamp_photo_creator on public.talent_photos;
create trigger stamp_photo_creator before insert on public.talent_photos
  for each row execute procedure public.stamp_created_by();

create index if not exists talent_photos_order_idx on public.talent_photos (talent_id, display_order, created_at) where archived_at is null;

-- Videos are allowed in the talent media buckets; images keep the 009 size policy
-- in the app, videos may use the full bucket limit.
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
where id in ('talent-public', 'talent-private');

-- ---------------------------------------------------------------------------
-- Ordering and featured image (run as the caller; media.manage RLS applies)
-- ---------------------------------------------------------------------------
create or replace function public.reorder_talent_photos(target_talent uuid, photo_ids uuid[])
returns void language sql security invoker set search_path = public as $$
  update public.talent_photos p
  set display_order = o.position, portfolio_order = o.position, updated_at = now()
  from unnest(photo_ids) with ordinality as o(id, position)
  where p.id = o.id and p.talent_id = target_talent;
$$;

create or replace function public.set_featured_photo(target_talent uuid, photo uuid)
returns void language sql security invoker set search_path = public as $$
  update public.talent_photos
  set featured = (id = photo), is_cover = (id = photo), updated_at = now()
  where talent_id = target_talent and (featured or is_cover or id = photo);
$$;

revoke execute on function public.reorder_talent_photos(uuid, uuid[]), public.set_featured_photo(uuid, uuid) from public, anon;
grant execute on function public.reorder_talent_photos(uuid, uuid[]), public.set_featured_photo(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Videos
-- ---------------------------------------------------------------------------
create table if not exists public.talent_videos (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  title text,
  provider text not null,
  external_id text,
  url text,
  storage_path text,
  public_storage_path text,
  thumbnail_url text,
  "public" boolean not null default false,
  display_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint talent_videos_provider_check check (provider in ('youtube', 'vimeo', 'upload')),
  constraint talent_videos_source_check check (
    (provider in ('youtube', 'vimeo') and external_id is not null)
    or (provider = 'upload' and storage_path is not null))
);
create index if not exists talent_videos_talent_idx on public.talent_videos (talent_id, display_order) where archived_at is null;

drop trigger if exists stamp_video_creator on public.talent_videos;
create trigger stamp_video_creator before insert on public.talent_videos
  for each row execute procedure public.stamp_created_by();

-- ---------------------------------------------------------------------------
-- Portfolios and digital books (per talent; a photo may appear in many)
-- ---------------------------------------------------------------------------
create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  "public" boolean not null default false,
  is_default boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolios_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create unique index if not exists portfolios_talent_slug_idx on public.portfolios (talent_id, slug);
create unique index if not exists portfolios_one_default_idx on public.portfolios (talent_id) where is_default;

create table if not exists public.portfolio_images (
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  photo_id uuid not null references public.talent_photos(id) on delete cascade,
  display_order integer not null default 0,
  primary key (portfolio_id, photo_id)
);
create index if not exists portfolio_images_photo_idx on public.portfolio_images (photo_id);

create table if not exists public.digital_books (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  name text not null,
  "public" boolean not null default false,
  published_at timestamptz,
  display_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists digital_books_talent_idx on public.digital_books (talent_id, display_order);

create table if not exists public.digital_book_images (
  book_id uuid not null references public.digital_books(id) on delete cascade,
  photo_id uuid not null references public.talent_photos(id) on delete cascade,
  display_order integer not null default 0,
  primary key (book_id, photo_id)
);
create index if not exists digital_book_images_photo_idx on public.digital_book_images (photo_id);

drop trigger if exists stamp_book_creator on public.digital_books;
create trigger stamp_book_creator before insert on public.digital_books
  for each row execute procedure public.stamp_created_by();

create or replace function public.digital_book_published_at()
returns trigger language plpgsql as $$
begin
  if new."public" and (tg_op = 'INSERT' or not old."public") then new.published_at := now(); end if;
  if not new."public" then new.published_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists digital_book_published_at on public.digital_books;
create trigger digital_book_published_at before insert or update on public.digital_books
  for each row execute procedure public.digital_book_published_at();

-- A photo can only join a portfolio or book of the same talent.
create or replace function public.check_collection_photo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  collection_talent uuid;
  photo_talent uuid;
begin
  if tg_table_name = 'portfolio_images' then
    select talent_id into collection_talent from public.portfolios where id = new.portfolio_id;
  else
    select talent_id into collection_talent from public.digital_books where id = new.book_id;
  end if;
  select talent_id into photo_talent from public.talent_photos where id = new.photo_id;
  if collection_talent is distinct from photo_talent then
    raise exception 'Photo belongs to a different talent';
  end if;
  return new;
end;
$$;
drop trigger if exists check_portfolio_photo on public.portfolio_images;
create trigger check_portfolio_photo before insert or update on public.portfolio_images
  for each row execute procedure public.check_collection_photo();
drop trigger if exists check_book_photo on public.digital_book_images;
create trigger check_book_photo before insert or update on public.digital_book_images
  for each row execute procedure public.check_collection_photo();

-- Replace a collection's contents in one statement: the array order is the display order.
create or replace function public.set_portfolio_images(target_portfolio uuid, photo_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from public.portfolio_images where portfolio_id = target_portfolio and photo_id <> all(photo_ids);
  insert into public.portfolio_images (portfolio_id, photo_id, display_order)
  select target_portfolio, o.id, o.position from unnest(photo_ids) with ordinality as o(id, position)
  on conflict (portfolio_id, photo_id) do update set display_order = excluded.display_order;
end;
$$;

create or replace function public.set_digital_book_images(target_book uuid, photo_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from public.digital_book_images where book_id = target_book and photo_id <> all(photo_ids);
  insert into public.digital_book_images (book_id, photo_id, display_order)
  select target_book, o.id, o.position from unnest(photo_ids) with ordinality as o(id, position)
  on conflict (book_id, photo_id) do update set display_order = excluded.display_order;
end;
$$;

revoke execute on function public.set_portfolio_images(uuid, uuid[]), public.set_digital_book_images(uuid, uuid[]) from public, anon;
grant execute on function public.set_portfolio_images(uuid, uuid[]), public.set_digital_book_images(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.talent_videos enable row level security;
alter table public.portfolios enable row level security;
alter table public.portfolio_images enable row level security;
alter table public.digital_books enable row level security;
alter table public.digital_book_images enable row level security;
revoke all on public.talent_videos, public.portfolios, public.portfolio_images, public.digital_books, public.digital_book_images from anon;

drop policy if exists "media readers read videos" on public.talent_videos;
create policy "media readers read videos" on public.talent_videos for select to authenticated
  using (public.has_permission('media.view') or talent_id = public.current_talent_id());
drop policy if exists "media managers manage videos" on public.talent_videos;
create policy "media managers manage videos" on public.talent_videos for all to authenticated
  using (public.has_permission('media.manage')) with check (public.has_permission('media.manage'));

drop policy if exists "media readers read portfolios" on public.portfolios;
create policy "media readers read portfolios" on public.portfolios for select to authenticated
  using (public.has_permission('media.view') or talent_id = public.current_talent_id());
drop policy if exists "media managers manage portfolios" on public.portfolios;
create policy "media managers manage portfolios" on public.portfolios for all to authenticated
  using (public.has_permission('media.manage')) with check (public.has_permission('media.manage'));

drop policy if exists "media readers read portfolio images" on public.portfolio_images;
create policy "media readers read portfolio images" on public.portfolio_images for select to authenticated
  using (public.has_permission('media.view'));
drop policy if exists "media managers manage portfolio images" on public.portfolio_images;
create policy "media managers manage portfolio images" on public.portfolio_images for all to authenticated
  using (public.has_permission('media.manage')) with check (public.has_permission('media.manage'));

drop policy if exists "media readers read digital books" on public.digital_books;
create policy "media readers read digital books" on public.digital_books for select to authenticated
  using (public.has_permission('media.view') or talent_id = public.current_talent_id());
drop policy if exists "media managers manage digital books" on public.digital_books;
create policy "media managers manage digital books" on public.digital_books for all to authenticated
  using (public.has_permission('media.manage')) with check (public.has_permission('media.manage'));

drop policy if exists "media readers read digital book images" on public.digital_book_images;
create policy "media readers read digital book images" on public.digital_book_images for select to authenticated
  using (public.has_permission('media.view'));
drop policy if exists "media managers manage digital book images" on public.digital_book_images;
create policy "media managers manage digital book images" on public.digital_book_images for all to authenticated
  using (public.has_permission('media.manage')) with check (public.has_permission('media.manage'));
