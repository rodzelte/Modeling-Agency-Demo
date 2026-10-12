-- 025: Security hardening (Phase 16).
--
-- Supabase's defaults grant the anon role full privileges on every new table;
-- RLS then blocks rows. The schema-wide test (tests/rls/hardening.test.mjs)
-- found anon still holding INSERT/UPDATE/DELETE on older talent-module tables.
-- RLS already denied every row, but grants should say the same thing:
--
-- * anon loses every write privilege everywhere in public;
-- * anon loses SELECT on everything except the public-site relations that
--   rely on anon-only policies and column grants (listed below);
-- * future tables and sequences no longer grant anon anything by default.

do $$
declare
  rel record;
  readable text[] := array[
    'public_boards_view', 'public_talents_view', 'public_talent_media_view', 'public_talent_portfolios_view', 'public_talent_skills_view',
    'public_pages_view', 'public_navigation_view', 'public_settings_view',
    'talent', 'talent_photos', 'talent_measurements', 'talent_board_assignments', 'boards', 'talent_videos', 'portfolios', 'portfolio_images',
    'digital_books', 'digital_book_images', 'talent_skills', 'skill_categories', 'skills',
    'website_pages', 'website_page_revisions', 'website_navigation', 'website_settings', 'website_redirects'];
begin
  for rel in
    select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', rel.relname);
    if not rel.relname = any(readable) then
      execute format('revoke select on public.%I from anon', rel.relname);
    end if;
  end loop;
end $$;

revoke all on all sequences in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------------------------------------------------------------------------
-- Permission matrix guard rails (the owner can now edit it in Settings)
-- ---------------------------------------------------------------------------
-- * The owner keeps every permission.
-- * The talent role never holds staff permissions: talent reach only their own
--   record through current_talent_id() policies. Granting e.g. talent.view to
--   the role would expose every talent to every talent login.
-- * Every change is audited.
create or replace function public.guard_role_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.role_key = 'owner' then
    raise exception 'The owner always holds every permission' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role_key = 'talent' then
    raise exception 'Talent logins cannot be given staff permissions' using errcode = '42501';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (auth.uid(), case when tg_op = 'DELETE' then 'permission.revoked' else 'permission.granted' end, 'role_permission',
    jsonb_build_object('role', coalesce(new.role_key, old.role_key), 'permission', coalesce(new.permission_key, old.permission_key)));
  return coalesce(new, old);
end;
$$;
drop trigger if exists guard_role_permissions on public.role_permissions;
create trigger guard_role_permissions before insert or update or delete on public.role_permissions
  for each row execute function public.guard_role_permissions();
revoke execute on function public.guard_role_permissions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Data-subject requests: the owner can erase an application and its photos
-- ---------------------------------------------------------------------------
drop policy if exists "owners delete applications" on public.applications;
create policy "owners delete applications" on public.applications for delete to authenticated using (public.has_permission('team.manage'));
grant delete on public.applications to authenticated;
drop policy if exists "owners delete application files" on storage.objects;
create policy "owners delete application files" on storage.objects for delete to authenticated
  using (bucket_id = 'applications' and public.has_permission('team.manage'));
-- Erasing a talent also removes their stored files (the app deletes objects first).
drop policy if exists "owners delete talent files" on storage.objects;
create policy "owners delete talent files" on storage.objects for delete to authenticated
  using (bucket_id in ('talent-private', 'talent-public', 'talent-documents') and public.has_permission('talent.delete'));
