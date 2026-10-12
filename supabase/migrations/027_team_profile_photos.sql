-- Phase 19: profile photos for team members (Dashboard → My profile).
-- Additive and idempotent.
--
-- Photos live in the public team-avatars bucket at <auth user id>/<file>, so the
-- dashboard can show them without signed URLs (like Google profile pictures).
-- Only active agency members may write, and only inside their own folder; the
-- URL is saved in the member's own Auth metadata (profile_photo_url).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-avatars', 'team-avatars', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members read own profile photos" on storage.objects;
create policy "members read own profile photos" on storage.objects for select to authenticated
  using (bucket_id = 'team-avatars' and split_part(name, '/', 1) = auth.uid()::text and public.is_active_agency_member());

drop policy if exists "members upload own profile photos" on storage.objects;
create policy "members upload own profile photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'team-avatars' and split_part(name, '/', 1) = auth.uid()::text and public.is_active_agency_member());

drop policy if exists "members delete own profile photos" on storage.objects;
create policy "members delete own profile photos" on storage.objects for delete to authenticated
  using (bucket_id = 'team-avatars' and split_part(name, '/', 1) = auth.uid()::text and public.is_active_agency_member());
