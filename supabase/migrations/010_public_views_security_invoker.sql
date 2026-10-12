-- 010: Public views run with the caller's rights (fixes Supabase advisor lint
-- 0010 "Security Definer View" on public_talent_directory / public_talent_profiles).
--
-- The views keep exactly the columns the website reads today. Instead of bypassing
-- RLS as the view owner, anonymous visitors now read through narrow policies that
-- expose only published talent, and column grants limited to public-safe fields.
-- Private columns (DOB, contact details, rates, notes) are never granted to anon;
-- public age comes from talent_public_age(), which returns an age only when the
-- talent is published and show_age is on.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Runs as the caller; for anon that means through the published-talent policy below.
create or replace function public.talent_is_public(target uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from public.talent t
    where t.id = target and t.publication_status = 'published' and t.show_on_website and t.archived_at is null
  );
$$;

create or replace function public.talent_public_age(target uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when t.show_age and t.date_of_birth is not null
              then date_part('year', age(current_date, t.date_of_birth))::int end
  from public.talent t
  where t.id = target and t.publication_status = 'published' and t.show_on_website and t.archived_at is null;
$$;

revoke execute on function public.talent_is_public(uuid), public.talent_public_age(uuid) from public;
grant execute on function public.talent_is_public(uuid), public.talent_public_age(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Anonymous access: explicit columns and published rows only
-- ---------------------------------------------------------------------------
revoke all on public.talent, public.talent_photos, public.talent_measurements, public.talent_board_assignments, public.boards from anon;

grant select (id, slug, talent_id, display_name, location, gender, featured, public_bio, show_age,
              publication_status, show_on_website, archived_at) on public.talent to anon;
grant select (id, talent_id, "public", public_storage_path, title, alt_text, display_order, featured, archived_at, created_at)
  on public.talent_photos to anon;
grant select (id, talent_id, measured_on, is_official, created_at, height_cm, bust_chest_cm, waist_cm, hips_cm,
              shoe_size_us, eye_color, hair_color) on public.talent_measurements to anon;
grant select (talent_id, board_id, sort_order) on public.talent_board_assignments to anon;
grant select (id, name, slug, description, parent_board_id, sort_order, is_active, publish_to_website, internal_only)
  on public.boards to anon;

drop policy if exists "public reads published talent" on public.talent;
create policy "public reads published talent" on public.talent for select to anon
  using (publication_status = 'published' and show_on_website and archived_at is null);

drop policy if exists "public reads published photos" on public.talent_photos;
create policy "public reads published photos" on public.talent_photos for select to anon
  using ("public" and public_storage_path is not null and archived_at is null and public.talent_is_public(talent_id));

drop policy if exists "public reads published measurements" on public.talent_measurements;
create policy "public reads published measurements" on public.talent_measurements for select to anon
  using (public.talent_is_public(talent_id));

-- Only assignments to boards the public can see (boards RLS applies to the subquery).
drop policy if exists "public reads published board assignments" on public.talent_board_assignments;
create policy "public reads published board assignments" on public.talent_board_assignments for select to anon
  using (public.talent_is_public(talent_id) and exists (select 1 from public.boards b where b.id = board_id));

-- ---------------------------------------------------------------------------
-- Views: same columns as 009, now security_invoker
-- ---------------------------------------------------------------------------
create or replace view public.public_talent_directory with (security_invoker = true) as
select
  t.id,
  t.slug,
  coalesce(t.talent_id, t.id::text) as talent_id,
  t.display_name,
  t.location,
  t.gender,
  public.talent_public_age(t.id) as age,
  t.featured,
  b.name as board_name,
  b.slug as board_slug,
  img.public_storage_path as primary_image_path
from public.talent t
join public.talent_board_assignments tba on tba.talent_id = t.id
join public.boards b on b.id = tba.board_id
left join lateral (
  select tp.public_storage_path from public.talent_photos tp
  where tp.talent_id = t.id and tp."public" and tp.public_storage_path is not null and tp.archived_at is null
  order by tp.featured desc, tp.display_order asc, tp.created_at asc limit 1
) img on true
where t.publication_status = 'published'
  and t.show_on_website
  and t.archived_at is null
  and b.is_active
  and b.publish_to_website
  and not b.internal_only;

create or replace view public.public_talent_profiles with (security_invoker = true) as
select
  t.id,
  t.slug,
  coalesce(t.talent_id, t.id::text) as talent_id,
  t.display_name,
  t.location,
  t.gender,
  public.talent_public_age(t.id) as age,
  t.featured,
  t.public_bio,
  coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'slug', b.slug) order by b.sort_order, b.name)
    from public.talent_board_assignments tba join public.boards b on b.id = tba.board_id
    where tba.talent_id = t.id and b.is_active and b.publish_to_website and not b.internal_only), '[]'::jsonb) as boards,
  m.height_cm, m.bust_chest_cm as bust_cm, m.waist_cm, m.hips_cm, m.shoe_size_us::text as shoe_size, m.eye_color, m.hair_color,
  coalesce((select jsonb_agg(jsonb_build_object('storage_path', tp.public_storage_path, 'title', tp.title, 'alt_text', tp.alt_text, 'display_order', tp.display_order) order by tp.display_order, tp.created_at)
    from public.talent_photos tp
    where tp.talent_id = t.id and tp."public" and tp.public_storage_path is not null and tp.archived_at is null), '[]'::jsonb) as gallery
from public.talent t
left join lateral (
  select tm.height_cm, tm.bust_chest_cm, tm.waist_cm, tm.hips_cm, tm.shoe_size_us, tm.eye_color, tm.hair_color
  from public.talent_measurements tm
  where tm.talent_id = t.id
  order by tm.is_official desc, tm.measured_on desc, tm.created_at desc limit 1
) m on true
where t.publication_status = 'published' and t.show_on_website and t.archived_at is null
  and exists (select 1 from public.talent_board_assignments tba join public.boards b on b.id = tba.board_id
              where tba.talent_id = t.id and b.is_active and b.publish_to_website and not b.internal_only);

grant select on public.public_talent_directory, public.public_talent_profiles to anon, authenticated;
