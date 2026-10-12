-- Public profile projection, storage buckets, and auth-profile bootstrap.
insert into storage.buckets (id, name, public) values
  ('talent-public', 'talent-public', true), ('talent-private', 'talent-private', false),
  ('talent-documents', 'talent-documents', false), ('applications', 'applications', false),
  ('comp-cards', 'comp-cards', true), ('cms-media', 'cms-media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "agency public talent media is readable" on storage.objects;
create policy "agency public talent media is readable" on storage.objects for select to anon, authenticated
  using (bucket_id = 'talent-public');
drop policy if exists "agency staff upload talent public media" on storage.objects;
create policy "agency staff upload talent public media" on storage.objects for insert to authenticated
  with check (bucket_id = 'talent-public' and public.has_any_role(array['owner','administrator','talent_manager','creative']));
drop policy if exists "agency staff update talent public media" on storage.objects;
create policy "agency staff update talent public media" on storage.objects for update to authenticated
  using (bucket_id = 'talent-public' and public.has_any_role(array['owner','administrator','talent_manager','creative']));
drop policy if exists "agency staff delete talent public media" on storage.objects;
create policy "agency staff delete talent public media" on storage.objects for delete to authenticated
  using (bucket_id = 'talent-public' and public.has_any_role(array['owner','administrator','talent_manager','creative']));

create or replace view public.public_talent_profiles as
select
  t.id,
  t.slug,
  coalesce(t.talent_id, t.id::text) as talent_id,
  t.first_name,
  t.last_name,
  t.display_name,
  t.location,
  t.gender,
  t.date_of_birth,
  t.featured,
  coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'slug', b.slug) order by b.sort_order, b.name)
    from public.talent_board_assignments tba join public.boards b on b.id = tba.board_id
    where tba.talent_id = t.id and b.is_active and b.publish_to_website and not b.internal_only), '[]'::jsonb) as boards,
  (select tm.height_cm from public.talent_measurements tm where tm.talent_id = t.id order by tm.is_official desc, tm.measured_on desc limit 1) as height_cm,
  (select tm.bust_chest_cm from public.talent_measurements tm where tm.talent_id = t.id order by tm.is_official desc, tm.measured_on desc limit 1) as bust_cm,
  (select tm.waist_cm from public.talent_measurements tm where tm.talent_id = t.id order by tm.is_official desc, tm.measured_on desc limit 1) as waist_cm,
  (select tm.hips_cm from public.talent_measurements tm where tm.talent_id = t.id order by tm.is_official desc, tm.measured_on desc limit 1) as hips_cm,
  (select tm.shoe_size_us::text from public.talent_measurements tm where tm.talent_id = t.id order by tm.is_official desc, tm.measured_on desc limit 1) as shoe_size,
  (select tm.eye_color from public.talent_measurements tm where tm.talent_id = t.id order by tm.is_official desc, tm.measured_on desc limit 1) as eye_color,
  (select tm.hair_color from public.talent_measurements tm where tm.talent_id = t.id order by tm.is_official desc, tm.measured_on desc limit 1) as hair_color,
  coalesce((select jsonb_agg(jsonb_build_object('storage_path', tp.storage_path, 'title', tp.title, 'alt_text', tp.alt_text, 'display_order', tp.display_order) order by tp.display_order, tp.created_at)
    from public.talent_photos tp where tp.talent_id = t.id and tp."public" and tp.archived_at is null), '[]'::jsonb) as gallery
from public.talent t
where t.publication_status = 'published' and t.show_on_website and t.archived_at is null
  and exists (select 1 from public.talent_board_assignments tba join public.boards b on b.id = tba.board_id where tba.talent_id = t.id and b.is_active and b.publish_to_website and not b.internal_only);

grant select on public.public_talent_profiles to anon, authenticated;

create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, status)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'display_name', ''), 'active')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_profile();

