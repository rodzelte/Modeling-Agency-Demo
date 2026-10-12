-- 017: Public-safe views for the website.
--
-- The views run with the caller's rights (security_invoker). Anonymous visitors read
-- them through narrow anon RLS policies and column grants on the underlying tables
-- (section 1), so nothing bypasses RLS. Every granted column is approved for public
-- display; add columns only after a privacy review.
--
-- A talent is public when: publication_status = 'published' AND show_on_website AND
-- not archived. A board is public when it and all its ancestors are active,
-- published, and not internal. Board pages list public talent assigned to that board.

drop view if exists public.public_talent_directory;
drop view if exists public.public_talent_profiles;
drop view if exists public.public_talent_skills_view;
drop view if exists public.public_talent_portfolios_view;
drop view if exists public.public_talent_media_view;
drop view if exists public.public_talents_view;
drop view if exists public.public_boards_view;

-- ---------------------------------------------------------------------------
-- 1. Anonymous access to the underlying tables (011 rebuilt all talent-module
--    policies and 012 reset talent grants, so the public-read rules are restated
--    here in full).
-- ---------------------------------------------------------------------------
-- DOB now lives in talent_private_details; age is still only returned for public
-- talent with show_age on.
create or replace function public.talent_public_age(target uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when t.show_age and pd.date_of_birth is not null
              then date_part('year', age(current_date, pd.date_of_birth))::int end
  from public.talent t
  left join public.talent_private_details pd on pd.talent_id = t.id
  where t.id = target and t.publication_status = 'published' and t.show_on_website and t.archived_at is null;
$$;

revoke all on public.talent, public.talent_photos, public.talent_measurements, public.talent_board_assignments, public.boards,
  public.talent_videos, public.portfolios, public.portfolio_images, public.digital_books, public.digital_book_images,
  public.talent_skills, public.skill_categories, public.skills from anon;

grant select (id, slug, display_name, location, gender, featured, show_in_search, public_bio, show_age, show_measurements,
              show_portfolio, show_videos, publication_status, show_on_website, archived_at, updated_at) on public.talent to anon;
grant select (id, talent_id, "public", public_storage_path, title, alt_text, photographer, display_order, featured, archived_at, created_at)
  on public.talent_photos to anon;
grant select (id, talent_id, measured_on, is_official, created_at, height_cm, bust_chest_cm, waist_cm, hips_cm, shoe_size_us,
              suit_size, inseam_cm, eye_color, hair_color) on public.talent_measurements to anon;
grant select (talent_id, board_id, sort_order) on public.talent_board_assignments to anon;
grant select (id, name, slug, path_segment, description, website_section, show_in_navigation, parent_board_id, sort_order,
              is_active, publish_to_website, internal_only) on public.boards to anon;
grant select (id, talent_id, title, provider, external_id, public_storage_path, "public", display_order, archived_at) on public.talent_videos to anon;
grant select (id, talent_id, name, slug, description, "public", is_default, display_order) on public.portfolios to anon;
grant select (portfolio_id, photo_id, display_order) on public.portfolio_images to anon;
grant select (id, talent_id, name, "public", display_order) on public.digital_books to anon;
grant select (book_id, photo_id, display_order) on public.digital_book_images to anon;
grant select (talent_id, category, skill, level, category_id, skill_id, is_public) on public.talent_skills to anon;
grant select (id, name) on public.skill_categories to anon;
grant select (id, name) on public.skills to anon;

drop policy if exists "public reads published talent" on public.talent;
create policy "public reads published talent" on public.talent for select to anon
  using (publication_status = 'published' and show_on_website and archived_at is null);

drop policy if exists "public reads published photos" on public.talent_photos;
create policy "public reads published photos" on public.talent_photos for select to anon
  using ("public" and public_storage_path is not null and archived_at is null and public.talent_is_public(talent_id));

drop policy if exists "public reads published measurements" on public.talent_measurements;
create policy "public reads published measurements" on public.talent_measurements for select to anon
  using (public.talent_is_public(talent_id)
         and exists (select 1 from public.talent t where t.id = talent_measurements.talent_id and t.show_measurements));

drop policy if exists "public reads published board assignments" on public.talent_board_assignments;
create policy "public reads published board assignments" on public.talent_board_assignments for select to anon
  using (public.talent_is_public(talent_id) and exists (select 1 from public.boards b where b.id = board_id));

drop policy if exists "public reads published videos" on public.talent_videos;
create policy "public reads published videos" on public.talent_videos for select to anon
  using ("public" and archived_at is null and (provider in ('youtube', 'vimeo') or public_storage_path is not null)
         and public.talent_is_public(talent_id)
         and exists (select 1 from public.talent t where t.id = talent_videos.talent_id and t.show_videos));

drop policy if exists "public reads published portfolios" on public.portfolios;
create policy "public reads published portfolios" on public.portfolios for select to anon
  using ("public" and public.talent_is_public(talent_id)
         and exists (select 1 from public.talent t where t.id = portfolios.talent_id and t.show_portfolio));

drop policy if exists "public reads published portfolio images" on public.portfolio_images;
create policy "public reads published portfolio images" on public.portfolio_images for select to anon
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id)
         and exists (select 1 from public.talent_photos ph where ph.id = photo_id));

drop policy if exists "public reads published digital books" on public.digital_books;
create policy "public reads published digital books" on public.digital_books for select to anon
  using ("public" and public.talent_is_public(talent_id)
         and exists (select 1 from public.talent t where t.id = digital_books.talent_id and t.show_portfolio));

drop policy if exists "public reads published digital book images" on public.digital_book_images;
create policy "public reads published digital book images" on public.digital_book_images for select to anon
  using (exists (select 1 from public.digital_books d where d.id = book_id)
         and exists (select 1 from public.talent_photos ph where ph.id = photo_id));

drop policy if exists "public reads public skills" on public.talent_skills;
create policy "public reads public skills" on public.talent_skills for select to anon
  using (is_public and public.talent_is_public(talent_id));

drop policy if exists "public reads skill catalogue" on public.skill_categories;
create policy "public reads skill catalogue" on public.skill_categories for select to anon using (true);
drop policy if exists "public reads skills catalogue" on public.skills;
create policy "public reads skills catalogue" on public.skills for select to anon using (true);

-- ---------------------------------------------------------------------------
-- 2. Views
-- ---------------------------------------------------------------------------
create view public.public_boards_view with (security_invoker = true) as
with recursive tree as (
  select b.id, b.parent_board_id, b.name, b.slug, b.description, b.website_section, b.show_in_navigation,
         b.sort_order, b.path_segment::text as path, 0 as depth
  from public.boards b
  where b.parent_board_id is null and b.is_active and b.publish_to_website and not b.internal_only
  union all
  select c.id, c.parent_board_id, c.name, c.slug, c.description, c.website_section, c.show_in_navigation,
         c.sort_order, t.path || '/' || c.path_segment, t.depth + 1
  from public.boards c
  join tree t on c.parent_board_id = t.id
  where c.is_active and c.publish_to_website and not c.internal_only and t.depth < 5
)
select id, parent_board_id as parent_id, name, slug, description, website_section, show_in_navigation, sort_order, path, depth
from tree;

create view public.public_talents_view with (security_invoker = true) as
select
  t.id,
  t.slug,
  t.display_name,
  t.location,
  t.gender,
  public.talent_public_age(t.id) as age,
  t.featured,
  t.show_in_search,
  t.public_bio,
  t.show_measurements,
  t.show_portfolio,
  t.show_videos,
  img.public_storage_path as primary_image_path,
  img.alt_text as primary_image_alt,
  case when t.show_measurements then m.height_cm end as height_cm,
  case when t.show_measurements then m.bust_chest_cm end as bust_cm,
  case when t.show_measurements then m.waist_cm end as waist_cm,
  case when t.show_measurements then m.hips_cm end as hips_cm,
  case when t.show_measurements then m.shoe_size_us::text end as shoe_size,
  case when t.show_measurements then m.suit_size end as suit_size,
  case when t.show_measurements then m.inseam_cm end as inseam_cm,
  case when t.show_measurements then m.eye_color end as eye_color,
  case when t.show_measurements then m.hair_color end as hair_color,
  coalesce(bb.boards, '[]'::jsonb) as boards,
  coalesce(bb.paths, '{}'::text[]) as board_paths,
  t.updated_at
from public.talent t
left join lateral (
  select p.public_storage_path, p.alt_text from public.talent_photos p
  where p.talent_id = t.id and p."public" and p.public_storage_path is not null and p.archived_at is null
  order by p.featured desc, p.display_order asc, p.created_at asc
  limit 1
) img on true
left join lateral (
  select tm.height_cm, tm.bust_chest_cm, tm.waist_cm, tm.hips_cm, tm.shoe_size_us, tm.suit_size, tm.inseam_cm, tm.eye_color, tm.hair_color
  from public.talent_measurements tm
  where tm.talent_id = t.id
  order by tm.is_official desc, tm.measured_on desc, tm.created_at desc
  limit 1
) m on true
left join lateral (
  select jsonb_agg(jsonb_build_object('id', pb.id, 'name', pb.name, 'slug', pb.slug, 'path', pb.path, 'sort_order', tba.sort_order)
                   order by pb.depth, pb.sort_order, pb.name) as boards,
         array_agg(pb.path order by pb.path) as paths
  from public.talent_board_assignments tba
  join public.public_boards_view pb on pb.id = tba.board_id
  where tba.talent_id = t.id
) bb on true
where t.publication_status = 'published'
  and t.show_on_website
  and t.archived_at is null;

create view public.public_talent_media_view with (security_invoker = true) as
select p.id, p.talent_id, 'image'::text as media_type, p.public_storage_path as image_path, p.title, p.alt_text,
       p.photographer, p.featured, p.display_order, null::text as provider, null::text as external_id, null::text as video_path
from public.talent_photos p
join public.talent t on t.id = p.talent_id
where t.publication_status = 'published' and t.show_on_website and t.archived_at is null
  and p."public" and p.public_storage_path is not null and p.archived_at is null
union all
select v.id, v.talent_id, 'video', null, v.title, v.title, null, false, v.display_order, v.provider, v.external_id, v.public_storage_path
from public.talent_videos v
join public.talent t on t.id = v.talent_id
where t.publication_status = 'published' and t.show_on_website and t.archived_at is null and t.show_videos
  and v."public" and v.archived_at is null
  and (v.provider in ('youtube', 'vimeo') or v.public_storage_path is not null);

create view public.public_talent_portfolios_view with (security_invoker = true) as
select pf.id, pf.talent_id, 'portfolio'::text as kind, pf.name, pf.slug, pf.description, pf.is_default, pf.display_order,
       coalesce((
         select jsonb_agg(jsonb_build_object('id', p.id, 'image_path', p.public_storage_path, 'alt_text', p.alt_text, 'title', p.title)
                          order by pi.display_order, p.display_order)
         from public.portfolio_images pi
         join public.talent_photos p on p.id = pi.photo_id
         where pi.portfolio_id = pf.id and p."public" and p.public_storage_path is not null and p.archived_at is null
       ), '[]'::jsonb) as images
from public.portfolios pf
join public.talent t on t.id = pf.talent_id
where t.publication_status = 'published' and t.show_on_website and t.archived_at is null and t.show_portfolio and pf."public"
union all
select db.id, db.talent_id, 'digitals', db.name, null, null, false, 1000 + db.display_order,
       coalesce((
         select jsonb_agg(jsonb_build_object('id', p.id, 'image_path', p.public_storage_path, 'alt_text', p.alt_text, 'title', p.title)
                          order by dbi.display_order, p.display_order)
         from public.digital_book_images dbi
         join public.talent_photos p on p.id = dbi.photo_id
         where dbi.book_id = db.id and p."public" and p.public_storage_path is not null and p.archived_at is null
       ), '[]'::jsonb)
from public.digital_books db
join public.talent t on t.id = db.talent_id
where t.publication_status = 'published' and t.show_on_website and t.archived_at is null and t.show_portfolio and db."public";

create view public.public_talent_skills_view with (security_invoker = true) as
select ts.talent_id, coalesce(sc.name, ts.category) as category, coalesce(s.name, ts.skill) as skill, ts.level
from public.talent_skills ts
join public.talent t on t.id = ts.talent_id
left join public.skill_categories sc on sc.id = ts.category_id
left join public.skills s on s.id = ts.skill_id
where ts.is_public and t.publication_status = 'published' and t.show_on_website and t.archived_at is null;

revoke all on public.public_boards_view, public.public_talents_view, public.public_talent_media_view,
  public.public_talent_portfolios_view, public.public_talent_skills_view from anon, authenticated;
grant select on public.public_boards_view, public.public_talents_view, public.public_talent_media_view,
  public.public_talent_portfolios_view, public.public_talent_skills_view to anon, authenticated;
