-- Public profiles mixed digitals (plain casting snapshots) into the portfolio
-- grid, because the public media view did not say what kind of photo each one
-- is. Expose talent_photos.image_type ('digital', 'portfolio', 'headshot', …)
-- so the site can show digitals in their own Digitals section. Additive: the
-- view keeps every existing column and filter, with image_type appended.
grant select (image_type) on public.talent_photos to anon;

create or replace view public.public_talent_media_view with (security_invoker = true) as
select p.id, p.talent_id, 'image'::text as media_type, p.public_storage_path as image_path, p.title, p.alt_text,
       p.photographer, p.featured, p.display_order, null::text as provider, null::text as external_id, null::text as video_path,
       p.image_type
from public.talent_photos p
join public.talent t on t.id = p.talent_id
where t.publication_status = 'published' and t.show_on_website and t.archived_at is null
  and p."public" and p.public_storage_path is not null and p.archived_at is null
union all
select v.id, v.talent_id, 'video', null, v.title, v.title, null, false, v.display_order, v.provider, v.external_id, v.public_storage_path,
       null::text
from public.talent_videos v
join public.talent t on t.id = v.talent_id
where t.publication_status = 'published' and t.show_on_website and t.archived_at is null and t.show_videos
  and v."public" and v.archived_at is null
  and (v.provider in ('youtube', 'vimeo') or v.public_storage_path is not null);

revoke all on public.public_talent_media_view from anon, authenticated;
grant select on public.public_talent_media_view to anon, authenticated;
