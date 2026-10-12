-- 009: Security hardening.
--
-- Fixes (see docs/discovery.md §5 and docs/security-review.md):
--   S1  Users could escalate their own role by editing profiles.role / profiles.email
--       or inserting profile_roles rows. Roles now resolve only from agency_members,
--       bound to the Auth user id; profiles and profile_roles are read-only mirrors.
--   S2  talent-public storage was listable by anyone. Anonymous listing is removed,
--       new uploads go to the private bucket, and buckets get size/MIME limits.
--   S3  audit_log had no RLS. RLS is enabled; audit writes go through write_audit()
--       and bypass-proof triggers into audit_logs.
--   S4  Public views exposed exact date of birth and legal names.
--
-- Everything here is additive or idempotent. Existing members stay bound by their
-- current email, so nobody who has access today loses it.

-- ---------------------------------------------------------------------------
-- 1. Bind agency membership to the Auth user id
-- ---------------------------------------------------------------------------
alter table public.agency_members add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists agency_members_user_id_idx on public.agency_members (user_id);

-- Backfill from the email match the previous helpers relied on. Existing access is
-- preserved as-is; new bindings (below) additionally require a confirmed email.
update public.agency_members am
set user_id = u.id
from (
  select distinct on (lower(email)) id, lower(email) as email
  from auth.users
  where email is not null
  order by lower(email), email_confirmed_at desc nulls last, created_at asc
) u
where am.user_id is null
  and u.email = lower(am.email)
  and not exists (select 1 from public.agency_members other where other.user_id = u.id);

-- Abort (the whole migration is one transaction) rather than lock the owner out.
do $$
begin
  if exists (
    select 1
    from public.agency_members am
    join auth.users u on lower(u.email) = lower(am.email)
    where am.role = 'owner' and am.status = 'active' and am.user_id is null
  ) then
    raise exception '009_security_hardening: an active owner with an existing Auth user could not be bound; aborting to avoid lockout';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Role resolution: agency_members.user_id = auth.uid() is the only authority
-- ---------------------------------------------------------------------------
create or replace function public.current_agency_role()
returns text language sql stable security definer set search_path = public as $$
  select am.role
  from public.agency_members am
  where am.user_id = auth.uid()
    and am.status = 'active'
  limit 1;
$$;

create or replace function public.has_role(required_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_agency_role() = required_role, false);
$$;

create or replace function public.has_any_role(required_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_agency_role() = any(required_roles), false);
$$;

create or replace function public.is_active_agency_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_agency_role() is not null;
$$;

revoke execute on function public.current_agency_role() from public, anon;
grant execute on function public.current_agency_role() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Membership <-> Auth user binding and profile mirroring
-- ---------------------------------------------------------------------------

-- user_id is always derived from the membership email, never chosen by the caller:
-- re-derived when the row is new, when its email changes, or while it is unbound.
create or replace function public.agency_members_bind_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(new.email);
  if tg_op = 'INSERT' or new.email is distinct from lower(old.email) or old.user_id is null then
    new.user_id := (
      select u.id from auth.users u
      where lower(u.email) = new.email
        and u.email_confirmed_at is not null
        and not exists (select 1 from public.agency_members other where other.user_id = u.id and other.id <> new.id)
      order by u.created_at asc
      limit 1
    );
  else
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists agency_members_bind_user on public.agency_members;
create trigger agency_members_bind_user before insert or update on public.agency_members
  for each row execute procedure public.agency_members_bind_user();

-- Never remove or demote the last active owner.
create or replace function public.agency_members_protect_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active')
     and not exists (
       select 1 from public.agency_members am
       where am.id <> old.id and am.role = 'owner' and am.status = 'active'
     ) then
    raise exception 'The last active owner cannot be removed or demoted';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists agency_members_protect_owner on public.agency_members;
create trigger agency_members_protect_owner before update or delete on public.agency_members
  for each row execute procedure public.agency_members_protect_owner();

-- profiles.role/status and profile_roles mirror the bound membership.
create or replace function public.sync_member_profile(member public.agency_members)
returns void language plpgsql security definer set search_path = public as $$
begin
  if member.user_id is null then return; end if;

  insert into public.profiles (id, email, full_name, role, status)
  select u.id, lower(coalesce(u.email, '')), coalesce(member.full_name, ''), member.role, member.status
  from auth.users u where u.id = member.user_id
  on conflict (id) do update set
    role = excluded.role,
    status = excluded.status,
    full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end,
    updated_at = now();

  delete from public.profile_roles where profile_id = member.user_id;
  insert into public.profile_roles (profile_id, role_id)
  select member.user_id, r.id from public.roles r where r.key = member.role
  on conflict do nothing;
end;
$$;

create or replace function public.agency_members_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.user_id is not null and old.user_id is distinct from new.user_id) then
    update public.profiles set status = 'suspended', updated_at = now() where id = old.user_id;
    delete from public.profile_roles where profile_id = old.user_id;
  end if;

  if tg_op <> 'DELETE' then
    perform public.sync_member_profile(new);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    auth.uid(),
    'agency_member.' || lower(tg_op),
    'agency_members',
    coalesce(new.id, old.id),
    case when tg_op <> 'INSERT' then jsonb_build_object('email', old.email, 'role', old.role, 'status', old.status) end,
    case when tg_op <> 'DELETE' then jsonb_build_object('email', new.email, 'role', new.role, 'status', new.status) end
  );
  return null;
end;
$$;

-- Audit columns must exist before the trigger above can fire.
alter table public.audit_logs add column if not exists before_data jsonb;
alter table public.audit_logs add column if not exists after_data jsonb;

drop trigger if exists agency_members_after_change on public.agency_members;
create trigger agency_members_after_change after insert or update or delete on public.agency_members
  for each row execute procedure public.agency_members_after_change();

-- New Auth users: create the profile, then bind a matching confirmed invitation.
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''), ''),
    'read_only',
    'pending'
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();

  perform public.bind_auth_user_membership(new.id, new.email, new.email_confirmed_at);
  return new;
end;
$$;

-- Touching an unbound membership makes agency_members_bind_user derive its user_id.
create or replace function public.bind_auth_user_membership(auth_user_id uuid, auth_email text, confirmed_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if confirmed_at is null or auth_email is null then return; end if;
  if exists (select 1 from public.agency_members where user_id = auth_user_id) then return; end if;
  update public.agency_members set updated_at = now()
  where lower(email) = lower(auth_email) and user_id is null;
end;
$$;

revoke execute on function public.bind_auth_user_membership(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.sync_member_profile(public.agency_members) from public, anon, authenticated;

create or replace function public.handle_auth_user_updated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = lower(coalesce(new.email, '')), updated_at = now() where id = new.id;
  perform public.bind_auth_user_membership(new.id, new.email, new.email_confirmed_at);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_profile();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated after update of email, email_confirmed_at on auth.users
  for each row execute procedure public.handle_auth_user_updated();

-- Bring every existing mirror in line with the (now authoritative) memberships.
do $$
declare
  member public.agency_members%rowtype;
begin
  for member in select * from public.agency_members where user_id is not null loop
    perform public.sync_member_profile(member);
  end loop;
end;
$$;

-- Undo any self-edited profile emails.
update public.profiles p
set email = lower(coalesce(u.email, '')), updated_at = now()
from auth.users u
where u.id = p.id and p.email is distinct from lower(coalesce(u.email, ''));

-- Profiles of users with no membership lose any role they granted themselves.
update public.profiles p
set role = 'read_only', status = 'pending', updated_at = now()
where not exists (select 1 from public.agency_members am where am.user_id = p.id)
  and (p.role <> 'read_only' or p.status <> 'pending');

delete from public.profile_roles pr
where not exists (select 1 from public.agency_members am where am.user_id = pr.profile_id);

-- ---------------------------------------------------------------------------
-- 4. Lock down profiles, profile_roles, agency_members, roles
-- ---------------------------------------------------------------------------
drop policy if exists "agency owners can manage profiles" on public.profiles;
drop policy if exists "agency users can view own profile" on public.profiles;
create policy "agency users can view own profile" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_any_role(array['owner','administrator']));
drop policy if exists "agency users can update own name" on public.profiles;
create policy "agency users can update own name" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
revoke select on public.profiles from anon;
grant update (full_name, updated_at) on public.profiles to authenticated;

drop policy if exists "agency owners can manage profile roles" on public.profile_roles;
drop policy if exists "agency users can view own roles" on public.profile_roles;
create policy "agency users can view own roles" on public.profile_roles for select to authenticated
  using (profile_id = auth.uid() or public.has_any_role(array['owner','administrator']));
revoke insert, update, delete, truncate on public.profile_roles from anon, authenticated;
revoke select on public.profile_roles from anon;

drop policy if exists "agency admins can manage roles" on public.roles;
drop policy if exists "agency staff can read roles" on public.roles;
create policy "agency staff can read roles" on public.roles for select to authenticated
  using (public.is_active_agency_member());
drop policy if exists "agency owners manage roles" on public.roles;
create policy "agency owners manage roles" on public.roles for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));
revoke all on public.roles from anon;

drop policy if exists "agency members can view own membership" on public.agency_members;
create policy "agency members can view own membership" on public.agency_members for select to authenticated
  using (user_id = auth.uid() or public.has_role('owner'));
drop policy if exists "agency owners can manage memberships" on public.agency_members;
create policy "agency owners can manage memberships" on public.agency_members for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));

revoke all on public.agency_members from anon;
revoke insert, update on public.agency_members from authenticated;
grant insert (email, full_name, role, status, invited_by, updated_at) on public.agency_members to authenticated;
grant update (email, full_name, role, status, invited_by, updated_at) on public.agency_members to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Audit logging
-- ---------------------------------------------------------------------------
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
drop policy if exists "agency admins can view legacy audit log" on public.audit_log;
create policy "agency admins can view legacy audit log" on public.audit_log for select to authenticated
  using (public.has_any_role(array['owner','administrator']));

revoke all on public.audit_logs from anon;
revoke insert, update, delete, truncate on public.audit_logs from authenticated;
drop policy if exists "agency admins can view audit logs" on public.audit_logs;
create policy "agency admins can view audit logs" on public.audit_logs for select to authenticated
  using (public.has_any_role(array['owner','administrator']));

create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

-- The only way for application code to write an audit event. The actor is always
-- the caller; it cannot be forged.
create or replace function public.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_before jsonb default null,
  p_after jsonb default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_agency_member() then
    raise exception 'Only active agency members can write audit events';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata, before_data, after_data)
  values (auth.uid(), left(p_action, 120), left(p_entity_type, 80), p_entity_id, coalesce(p_metadata, '{}'::jsonb), p_before, p_after);
end;
$$;

revoke execute on function public.write_audit(text, text, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.write_audit(text, text, uuid, jsonb, jsonb, jsonb) to authenticated;

-- Publication changes are audited in the database so they cannot be skipped.
create or replace function public.audit_talent_publication()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.publication_status is distinct from old.publication_status
     or new.show_on_website is distinct from old.show_on_website
     or new.archived_at is distinct from old.archived_at then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (
      auth.uid(),
      case
        when new.archived_at is not null and old.archived_at is null then 'talent.archived'
        when new.publication_status = 'published' and new.show_on_website then 'talent.published'
        when old.publication_status = 'published' and old.show_on_website then 'talent.unpublished'
        else 'talent.publication_changed'
      end,
      'talent',
      new.id,
      jsonb_build_object('publication_status', old.publication_status, 'show_on_website', old.show_on_website, 'archived_at', old.archived_at),
      jsonb_build_object('publication_status', new.publication_status, 'show_on_website', new.show_on_website, 'archived_at', new.archived_at)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists audit_talent_publication on public.talent;
create trigger audit_talent_publication after update on public.talent
  for each row execute procedure public.audit_talent_publication();

-- ---------------------------------------------------------------------------
-- 6. Media: private by default, explicit promotion to the public bucket
-- ---------------------------------------------------------------------------
alter table public.talent_photos add column if not exists storage_bucket text not null default 'talent-public';
alter table public.talent_photos alter column storage_bucket set default 'talent-private';
alter table public.talent_photos add column if not exists public_storage_path text;
alter table public.talent_photos drop constraint if exists talent_photos_storage_bucket_check;
alter table public.talent_photos add constraint talent_photos_storage_bucket_check
  check (storage_bucket in ('talent-public', 'talent-private'));

-- Legacy rows were uploaded straight to the public bucket.
update public.talent_photos
set public_storage_path = storage_path
where public_storage_path is null and storage_bucket = 'talent-public' and "public";

update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['image/jpeg','image/png','image/webp']
  where id in ('talent-public', 'talent-private');
update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array[
  'application/pdf','image/jpeg','image/png','text/plain',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  where id = 'talent-documents';
update storage.buckets set file_size_limit = 15728640, allowed_mime_types = array['image/jpeg','image/png','image/webp']
  where id = 'applications';
update storage.buckets set file_size_limit = 20971520, allowed_mime_types = array['application/pdf','image/png','image/jpeg']
  where id = 'comp-cards';
update storage.buckets set file_size_limit = 52428800, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/svg+xml','video/mp4']
  where id = 'cms-media';

-- Public buckets serve /object/public/* without a SELECT policy, so dropping the
-- anonymous policy removes listing without breaking published image URLs.
drop policy if exists "agency public talent media is readable" on storage.objects;
drop policy if exists "agency staff read talent media" on storage.objects;
create policy "agency staff read talent media" on storage.objects for select to authenticated
  using (bucket_id in ('talent-public', 'talent-private')
         and public.has_any_role(array['owner','administrator','talent_manager','creative']));

drop policy if exists "agency staff upload talent private media" on storage.objects;
create policy "agency staff upload talent private media" on storage.objects for insert to authenticated
  with check (bucket_id = 'talent-private' and public.has_any_role(array['owner','administrator','talent_manager','creative']));
drop policy if exists "agency staff update talent private media" on storage.objects;
create policy "agency staff update talent private media" on storage.objects for update to authenticated
  using (bucket_id = 'talent-private' and public.has_any_role(array['owner','administrator','talent_manager','creative']));
drop policy if exists "agency staff delete talent private media" on storage.objects;
create policy "agency staff delete talent private media" on storage.objects for delete to authenticated
  using (bucket_id = 'talent-private' and public.has_any_role(array['owner','administrator','talent_manager','creative']));

-- ---------------------------------------------------------------------------
-- 7. Public views: no exact DOB, no legal names, opt-in age
-- ---------------------------------------------------------------------------
alter table public.talent add column if not exists show_age boolean not null default false;

drop view if exists public.public_talent_directory;
drop view if exists public.public_talent_profiles;

-- These views intentionally run with owner rights (security_invoker off) so anon can
-- read a narrow projection of RLS-protected tables. Keep the column lists minimal.
create view public.public_talent_directory as
select
  t.id,
  t.slug,
  coalesce(t.talent_id, t.id::text) as talent_id,
  t.display_name,
  t.location,
  t.gender,
  case when t.show_age and t.date_of_birth is not null
       then date_part('year', age(current_date, t.date_of_birth))::int end as age,
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

create view public.public_talent_profiles as
select
  t.id,
  t.slug,
  coalesce(t.talent_id, t.id::text) as talent_id,
  t.display_name,
  t.location,
  t.gender,
  case when t.show_age and t.date_of_birth is not null
       then date_part('year', age(current_date, t.date_of_birth))::int end as age,
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
  select tm.* from public.talent_measurements tm
  where tm.talent_id = t.id
  order by tm.is_official desc, tm.measured_on desc, tm.created_at desc limit 1
) m on true
where t.publication_status = 'published' and t.show_on_website and t.archived_at is null
  and exists (select 1 from public.talent_board_assignments tba join public.boards b on b.id = tba.board_id
              where tba.talent_id = t.id and b.is_active and b.publish_to_website and not b.internal_only);

revoke all on public.public_talent_directory, public.public_talent_profiles from anon, authenticated;
grant select on public.public_talent_directory, public.public_talent_profiles to anon, authenticated;
