-- Public reads are routed through narrow views over the existing schema.
create or replace view public.public_talent_directory as
select
  t.id,
  t.slug,
  coalesce(t.talent_id, t.id::text) as talent_id,
  t.display_name,
  t.location,
  t.gender,
  t.date_of_birth,
  t.featured,
  b.name as board_name,
  b.slug as board_slug,
  img.storage_path as primary_image_path
from public.talent t
join public.talent_board_assignments tba on tba.talent_id = t.id
join public.boards b on b.id = tba.board_id
left join lateral (
  select storage_path from public.talent_photos tp
  where tp.talent_id = t.id and tp."public" and tp.archived_at is null
  order by tp.featured desc, tp.display_order asc, tp.created_at asc limit 1
) img on true
where t.publication_status = 'published'
  and t.show_on_website
  and t.archived_at is null
  and b.is_active
  and b.publish_to_website
  and not b.internal_only;

grant select on public.public_talent_directory to anon, authenticated;

