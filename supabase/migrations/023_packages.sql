-- 023: Packages (curated talent selections for clients) and client sharing.
--
-- * packages + package_items, managed with packages.manage.
-- * A package is shared through an unguessable link. Only the SHA-256 hash of
--   the token is stored; links expire and can be revoked or rotated.
-- * get_shared_package(token_hash) is the ONLY anonymous way in: it returns
--   public-safe fields (display name, location, approved measurements, photos
--   approved for public use) for a live package and records a view. Never DOB,
--   contact details, legal/banking/medical data, notes, or unapproved photos.

insert into public.permissions (key, module, description) values
  ('packages.manage', 'packages', 'Create packages and share them with clients')
on conflict (key) do nothing;
insert into public.role_permissions (role_key, permission_key)
select v.role_key, 'packages.manage' from (values ('owner'), ('administrator'), ('talent_manager'), ('booker')) as v(role_key)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 160),
  message text check (length(message) <= 4000),
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.company_contacts(id) on delete set null,
  show_measurements boolean not null default true,
  share_token_hash text unique check (share_token_hash ~ '^[0-9a-f]{64}$'),
  shared_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists packages_created_idx on public.packages (created_at desc);

create table if not exists public.package_items (
  package_id uuid not null references public.packages(id) on delete cascade,
  talent_id uuid not null references public.talent(id) on delete cascade,
  sort_order integer not null default 0,
  note text check (length(note) <= 600),
  primary key (package_id, talent_id)
);
create index if not exists package_items_talent_idx on public.package_items (talent_id);

create or replace function public.touch_package()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists touch_package on public.packages;
create trigger touch_package before update on public.packages for each row execute function public.touch_package();

create or replace function public.audit_package()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id) values (auth.uid(), 'package.created', 'package', new.id);
  elsif new.share_token_hash is distinct from old.share_token_hash and new.share_token_hash is not null then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'package.shared', 'package', new.id, jsonb_build_object('expires_at', new.expires_at));
  elsif new.revoked_at is not null and old.revoked_at is null then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id) values (auth.uid(), 'package.revoked', 'package', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists audit_package on public.packages;
create trigger audit_package after insert or update on public.packages for each row execute function public.audit_package();
revoke execute on function public.touch_package(), public.audit_package() from public, anon, authenticated;

alter table public.packages enable row level security;
alter table public.package_items enable row level security;
revoke all on public.packages, public.package_items from anon;

drop policy if exists "package managers manage packages" on public.packages;
create policy "package managers manage packages" on public.packages for all to authenticated
  using (public.has_permission('packages.manage')) with check (public.has_permission('packages.manage'));
drop policy if exists "package managers manage items" on public.package_items;
create policy "package managers manage items" on public.package_items for all to authenticated
  using (public.has_permission('packages.manage')) with check (public.has_permission('packages.manage'));

-- The share page. p_token_hash = lowercase hex SHA-256 of the link token.
create or replace function public.get_shared_package(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pkg public.packages%rowtype;
  talent_json jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into pkg from public.packages
  where share_token_hash = p_token_hash and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;

  update public.packages set view_count = view_count + 1, last_viewed_at = now() where id = pkg.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.display_name,
    'location', t.location,
    'gender', t.gender,
    'note', pi.note,
    'profile_slug', case when t.publication_status = 'published' and t.show_on_website and t.archived_at is null then t.slug end,
    'measurements', case when pkg.show_measurements and t.show_measurements then (
      select jsonb_strip_nulls(jsonb_build_object('height_cm', m.height_cm, 'bust_cm', m.bust_chest_cm, 'waist_cm', m.waist_cm, 'hips_cm', m.hips_cm,
        'shoe_size', m.shoe_size_us, 'suit_size', m.suit_size, 'hair_color', m.hair_color, 'eye_color', m.eye_color))
      from public.talent_measurements m where m.talent_id = t.id
      order by m.is_official desc, m.measured_on desc, m.created_at desc limit 1) end,
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('path', p.public_storage_path, 'alt', p.alt_text) order by p.featured desc, p.display_order, p.created_at)
      from (select * from public.talent_photos p
            where p.talent_id = t.id and p."public" and p.public_storage_path is not null and p.archived_at is null
            order by p.featured desc, p.display_order, p.created_at limit 8) p
    ), '[]'::jsonb)
  ) order by pi.sort_order, t.display_name), '[]'::jsonb)
  into talent_json
  from public.package_items pi
  join public.talent t on t.id = pi.talent_id
  where pi.package_id = pkg.id and t.archived_at is null;

  return jsonb_build_object('title', pkg.title, 'message', pkg.message, 'expires_at', pkg.expires_at, 'talent', talent_json);
end;
$$;
revoke execute on function public.get_shared_package(text) from public;
grant execute on function public.get_shared_package(text) to anon, authenticated;
