-- 021: Website CMS.
--
-- * website_pages hold the working copy (title, SEO, sections). Publishing takes
--   an immutable snapshot into website_page_revisions and points the page at it,
--   so drafts never leak, every publish is kept, and rollback restores a snapshot.
-- * website_navigation, website_settings (public keys only are exposed) and
--   website_redirects (old site URLs → new routes).
-- * Anonymous visitors read only published data through security_invoker views.
-- * Publishing, unpublishing and restoring are audited by trigger.
-- * website.manage (owner/administrator) edits everything; website.publish can
--   be granted separately to let someone edit drafts but not publish.

insert into public.permissions (key, module, description) values
  ('website.publish', 'website', 'Publish, unpublish and roll back website pages')
on conflict (key) do nothing;
insert into public.role_permissions (role_key, permission_key)
select v.role_key, v.permission_key from (values ('owner', 'website.publish'), ('administrator', 'website.publish'),
  ('owner', 'website.manage'), ('administrator', 'website.manage')) as v(role_key, permission_key)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.website_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$' and length(slug) <= 120),
  title text not null check (length(title) between 1 and 160),
  seo_title text check (length(seo_title) <= 160),
  meta_description text check (length(meta_description) <= 320),
  og_image_path text,
  noindex boolean not null default false,
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_revision_id uuid,
  published_at timestamptz,
  has_unpublished_changes boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_page_revisions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.website_pages(id) on delete cascade,
  version integer not null,
  slug text not null,
  title text not null,
  seo_title text,
  meta_description text,
  og_image_path text,
  noindex boolean not null default false,
  sections jsonb not null,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (page_id, version)
);

do $$ begin
  alter table public.website_pages add constraint website_pages_published_revision_fk
    foreign key (published_revision_id) references public.website_page_revisions(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.website_navigation (
  id uuid primary key default gen_random_uuid(),
  location text not null default 'header' check (location in ('header', 'footer')),
  label text not null check (length(label) between 1 and 60),
  -- Internal paths (never protocol-relative //host), https links, or mailto.
  href text not null check (href ~ '^(/($|[a-z0-9_#?=&.-][a-z0-9/_#?=&.-]*)|https://[^\s]+|mailto:[^\s]+)$' and length(href) <= 500),
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_settings (
  key text primary key check (key ~ '^[a-z_]+$'),
  value jsonb not null,
  is_public boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.website_redirects (
  id uuid primary key default gen_random_uuid(),
  from_path text not null unique check (from_path ~ '^/[^\s]*$' and length(from_path) <= 300),
  -- Never protocol-relative (//host or /\host), which would be an open redirect.
  to_path text not null check (to_path ~ '^(/($|[^/\\[:space:]][^[:space:]]*)|https://[^[:space:]]+)$' and length(to_path) <= 500),
  permanent boolean not null default true,
  is_active boolean not null default true,
  hits integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists website_pages_status_idx on public.website_pages (status, slug);
create index if not exists website_page_revisions_page_idx on public.website_page_revisions (page_id, version desc);
create index if not exists website_navigation_location_idx on public.website_navigation (location, sort_order);

-- ---------------------------------------------------------------------------
-- 2. Bookkeeping, publishing, audit
-- ---------------------------------------------------------------------------
create or replace function public.prepare_website_page()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  -- New pages always start as unpublished drafts.
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.status := 'draft';
    new.published_revision_id := null;
    new.published_at := null;
    new.has_unpublished_changes := true;
  end if;
  if tg_op = 'UPDATE' and (new.title, new.slug, new.seo_title, new.meta_description, new.og_image_path, new.noindex, new.sections)
     is distinct from (old.title, old.slug, old.seo_title, old.meta_description, old.og_image_path, old.noindex, old.sections) then
    new.has_unpublished_changes := true;
  end if;
  -- Publication fields change only through publish_website_page()/unpublish.
  if tg_op = 'UPDATE' and auth.uid() is not null and current_setting('app.cms_publishing', true) is distinct from 'on'
     and (new.status, new.published_revision_id, new.published_at) is distinct from (old.status, old.published_revision_id, old.published_at) then
    raise exception 'Use Publish or Unpublish to change what is live' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists prepare_website_page on public.website_pages;
create trigger prepare_website_page before insert or update on public.website_pages
  for each row execute function public.prepare_website_page();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists touch_website_navigation on public.website_navigation;
create trigger touch_website_navigation before update on public.website_navigation for each row execute function public.touch_updated_at();
drop trigger if exists touch_website_settings on public.website_settings;
create trigger touch_website_settings before update on public.website_settings for each row execute function public.touch_updated_at();

-- Snapshot the working copy and make it live. Returns the new revision id.
create or replace function public.publish_website_page(p_page_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  page public.website_pages%rowtype;
  next_version integer;
  revision uuid;
begin
  if not public.has_permission('website.publish') then
    raise exception 'You do not have permission to publish website pages' using errcode = '42501';
  end if;
  select * into page from public.website_pages where id = p_page_id for update;
  if not found then raise exception 'Page not found' using errcode = 'P0002'; end if;
  if page.status = 'archived' then raise exception 'Restore the page before publishing it' using errcode = '22023'; end if;

  select coalesce(max(version), 0) + 1 into next_version from public.website_page_revisions where page_id = page.id;
  insert into public.website_page_revisions (page_id, version, slug, title, seo_title, meta_description, og_image_path, noindex, sections, published_by)
  values (page.id, next_version, page.slug, page.title, page.seo_title, page.meta_description, page.og_image_path, page.noindex, page.sections, auth.uid())
  returning id into revision;

  perform set_config('app.cms_publishing', 'on', true);
  update public.website_pages
  set status = 'published', published_revision_id = revision, published_at = now(), has_unpublished_changes = false
  where id = page.id;
  perform set_config('app.cms_publishing', 'off', true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'cms.page_published', 'website_page', page.id, jsonb_build_object('slug', page.slug, 'version', next_version));
  return revision;
end;
$$;

create or replace function public.unpublish_website_page(p_page_id uuid, p_archive boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('website.publish') then
    raise exception 'You do not have permission to unpublish website pages' using errcode = '42501';
  end if;
  perform set_config('app.cms_publishing', 'on', true);
  update public.website_pages
  set status = case when p_archive then 'archived' else 'draft' end, published_revision_id = null, published_at = null, has_unpublished_changes = true
  where id = p_page_id;
  perform set_config('app.cms_publishing', 'off', true);
  if not found then raise exception 'Page not found' using errcode = 'P0002'; end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (auth.uid(), case when p_archive then 'cms.page_archived' else 'cms.page_unpublished' end, 'website_page', p_page_id);
end;
$$;

-- Copies a revision back into the working copy (then publish to make it live).
create or replace function public.restore_website_revision(p_revision_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rev public.website_page_revisions%rowtype;
begin
  if not public.has_permission('website.manage') then
    raise exception 'You do not have permission to edit website pages' using errcode = '42501';
  end if;
  select * into rev from public.website_page_revisions where id = p_revision_id;
  if not found then raise exception 'Revision not found' using errcode = 'P0002'; end if;
  perform set_config('app.cms_publishing', 'on', true);
  update public.website_pages
  set title = rev.title, slug = rev.slug, seo_title = rev.seo_title, meta_description = rev.meta_description,
      og_image_path = rev.og_image_path, noindex = rev.noindex, sections = rev.sections,
      status = case when status = 'archived' then 'draft' else status end
  where id = rev.page_id;
  perform set_config('app.cms_publishing', 'off', true);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'cms.revision_restored', 'website_page', rev.page_id, jsonb_build_object('version', rev.version));
  return rev.page_id;
end;
$$;

-- Counts a redirect hit (anonymous visitors can call it; it only increments).
create or replace function public.record_redirect_hit(p_from_path text)
returns void language sql security definer set search_path = public as $$
  update public.website_redirects set hits = hits + 1 where from_path = p_from_path and is_active;
$$;

revoke execute on function public.prepare_website_page(), public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.publish_website_page(uuid), public.unpublish_website_page(uuid, boolean), public.restore_website_revision(uuid) from public, anon;
grant execute on function public.publish_website_page(uuid), public.unpublish_website_page(uuid, boolean), public.restore_website_revision(uuid) to authenticated;
revoke execute on function public.record_redirect_hit(text) from public;
grant execute on function public.record_redirect_hit(text) to anon, authenticated;

create or replace function public.audit_website_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'cms.' || tg_table_name || '.' || lower(tg_op), 'website', coalesce(new.id, old.id)::uuid, '{}'::jsonb);
  return coalesce(new, old);
end;
$$;
revoke execute on function public.audit_website_change() from public, anon, authenticated;
drop trigger if exists audit_website_navigation on public.website_navigation;
create trigger audit_website_navigation after insert or update or delete on public.website_navigation for each row execute function public.audit_website_change();
drop trigger if exists audit_website_redirects on public.website_redirects;
create trigger audit_website_redirects after insert or update or delete on public.website_redirects for each row execute function public.audit_website_change();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.website_pages enable row level security;
alter table public.website_page_revisions enable row level security;
alter table public.website_navigation enable row level security;
alter table public.website_settings enable row level security;
alter table public.website_redirects enable row level security;
revoke all on public.website_pages, public.website_page_revisions, public.website_navigation, public.website_settings, public.website_redirects from anon;
revoke insert, update, delete on public.website_page_revisions from authenticated;

do $$
declare t text;
begin
  foreach t in array array['website_pages', 'website_navigation', 'website_settings', 'website_redirects'] loop
    execute format('drop policy if exists "website editors read %1$s" on public.%1$I', t);
    execute format('create policy "website editors read %1$s" on public.%1$I for select to authenticated using (public.has_permission(''website.manage''))', t);
    execute format('drop policy if exists "website editors write %1$s" on public.%1$I', t);
    execute format('create policy "website editors write %1$s" on public.%1$I for all to authenticated using (public.has_permission(''website.manage'')) with check (public.has_permission(''website.manage''))', t);
  end loop;
end $$;
-- Pages: live pages cannot be deleted (unpublish or archive them first).
drop policy if exists "website editors write website_pages" on public.website_pages;
drop policy if exists "website editors add pages" on public.website_pages;
create policy "website editors add pages" on public.website_pages for insert to authenticated with check (public.has_permission('website.manage'));
drop policy if exists "website editors edit pages" on public.website_pages;
create policy "website editors edit pages" on public.website_pages for update to authenticated
  using (public.has_permission('website.manage')) with check (public.has_permission('website.manage'));
drop policy if exists "website editors delete unpublished pages" on public.website_pages;
create policy "website editors delete unpublished pages" on public.website_pages for delete to authenticated
  using (public.has_permission('website.manage') and status <> 'published');

drop policy if exists "website editors read revisions" on public.website_page_revisions;
create policy "website editors read revisions" on public.website_page_revisions for select to authenticated using (public.has_permission('website.manage'));

-- Anonymous visitors: live revisions, visible navigation, public settings, active redirects.
drop policy if exists "public reads live revisions" on public.website_page_revisions;
create policy "public reads live revisions" on public.website_page_revisions for select to anon
  using (exists (select 1 from public.website_pages p where p.published_revision_id = website_page_revisions.id and p.status = 'published'));
drop policy if exists "public reads published pages" on public.website_pages;
create policy "public reads published pages" on public.website_pages for select to anon using (status = 'published');
drop policy if exists "public reads navigation" on public.website_navigation;
create policy "public reads navigation" on public.website_navigation for select to anon using (is_visible);
drop policy if exists "public reads public settings" on public.website_settings;
create policy "public reads public settings" on public.website_settings for select to anon using (is_public);
drop policy if exists "public reads redirects" on public.website_redirects;
create policy "public reads redirects" on public.website_redirects for select to anon using (is_active);

grant select (id, status, published_revision_id) on public.website_pages to anon;
grant select (id, page_id, slug, title, seo_title, meta_description, og_image_path, noindex, sections, published_at) on public.website_page_revisions to anon;
grant select (id, location, label, href, sort_order, is_visible) on public.website_navigation to anon;
grant select (key, value, is_public) on public.website_settings to anon;
grant select (from_path, to_path, permanent, is_active) on public.website_redirects to anon;

-- Storage: cms-media is a public bucket (served by URL); only editors write to it.
drop policy if exists "website editors upload cms media" on storage.objects;
create policy "website editors upload cms media" on storage.objects for insert to authenticated
  with check (bucket_id = 'cms-media' and public.has_permission('website.manage'));
drop policy if exists "website editors update cms media" on storage.objects;
create policy "website editors update cms media" on storage.objects for update to authenticated
  using (bucket_id = 'cms-media' and public.has_permission('website.manage'));
drop policy if exists "website editors delete cms media" on storage.objects;
create policy "website editors delete cms media" on storage.objects for delete to authenticated
  using (bucket_id = 'cms-media' and public.has_permission('website.manage'));
drop policy if exists "website editors list cms media" on storage.objects;
create policy "website editors list cms media" on storage.objects for select to authenticated
  using (bucket_id = 'cms-media' and public.has_permission('website.manage'));
-- SVG can carry scripts; the public media bucket accepts raster images and MP4 only.
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'] where id = 'cms-media';

-- ---------------------------------------------------------------------------
-- 4. Public views
-- ---------------------------------------------------------------------------
create or replace view public.public_pages_view with (security_invoker = true) as
select r.page_id as id, r.slug, r.title, r.seo_title, r.meta_description, r.og_image_path, r.noindex, r.sections, r.published_at
from public.website_page_revisions r
join public.website_pages p on p.published_revision_id = r.id and p.status = 'published';

create or replace view public.public_navigation_view with (security_invoker = true) as
select id, location, label, href, sort_order from public.website_navigation where is_visible;

create or replace view public.public_settings_view with (security_invoker = true) as
select key, value from public.website_settings where is_public;

revoke all on public.public_pages_view, public.public_navigation_view, public.public_settings_view from anon, authenticated;
grant select on public.public_pages_view, public.public_navigation_view, public.public_settings_view to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Starting content (drafts; nothing is published by this migration)
-- ---------------------------------------------------------------------------
insert into public.website_settings (key, value, is_public) values
  ('contact_email', to_jsonb('lenny@42modelmanagement.com'::text), true),
  ('contact_phone', 'null'::jsonb, true),
  ('instagram_url', 'null'::jsonb, true),
  ('location_line', to_jsonb('Dallas–Fort Worth · USA – UK'::text), true),
  ('home_hero', jsonb_build_object('eyebrow', 'Independent talent / Dallas–Fort Worth', 'headline', E'The faces\nof now.',
     'text', null, 'image_path', null), true),
  ('home_about', jsonb_build_object('eyebrow', 'More than a roster', 'headline', E'People first.\nAlways.', 'text',
     'From first digitals to global campaigns, we help talent build meaningful careers and give clients access to a roster with range, intention, and staying power.', 'image_path', null), true),
  ('contact_heading', to_jsonb(E'Let''s make\nsomething real.'::text), true)
on conflict (key) do nothing;

insert into public.website_pages (slug, title, meta_description, sections) values
  ('about', 'About', 'About 42 Model Management.', jsonb_build_array(
    jsonb_build_object('id', 'about-intro', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'About 42 Model Management',
      'body', E'42 Model Management was founded in 2015 by Lenny Wheeler in Dallas–Fort Worth.\n\n[Owner: replace this text with the agency story.]')),
    jsonb_build_object('id', 'about-join', 'type', 'cta', 'data', jsonb_build_object('heading', 'Want to be represented?', 'text', 'Apply through our registration form.', 'label', 'Apply to join', 'href', '/join')))),
  ('privacy', 'Privacy Policy', 'How 42 Model Management collects and uses personal information.', jsonb_build_array(
    jsonb_build_object('id', 'privacy-body', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'Privacy Policy',
      'body', E'[DRAFT — have this reviewed by the agency''s legal adviser before publishing.]\n\n## Who we are\n42 Model Management ("we") represents models and talent. Contact: lenny@42modelmanagement.com.\n\n## What we collect\n- Applications: name, contact details, date of birth, measurements, photos and answers you submit through our registration form.\n- Represented talent: the details needed to represent you, including contact, identity, payment and booking information.\n- Website visitors: basic technical logs needed to run and secure the site.\n\n## How we use it\nTo assess applications, represent talent, arrange bookings, pay talent, meet legal obligations, and keep the site secure. We only publish information and images you have approved for public display.\n\n## Minors\nApplications from people under 18 require a parent or guardian. We never publish a minor''s date of birth, address or contact details.\n\n## Sharing\nWe share talent information with clients only as needed for castings and bookings, and with service providers who host our systems under contract.\n\n## Retention\nUnsuccessful applications are deleted after 12 months. Talent records are kept for the length of representation and as required by law.\n\n## Your rights\nYou can ask for a copy of your information, ask us to correct or delete it, or withdraw consent to SMS messages at any time by contacting us.\n\n## Changes\nWe will post any changes on this page.')))),
  ('terms', 'Terms of Use', 'Terms for using the 42 Model Management website.', jsonb_build_array(
    jsonb_build_object('id', 'terms-body', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'Terms of Use',
      'body', E'[DRAFT — have this reviewed by the agency''s legal adviser before publishing.]\n\nImages and content on this site belong to 42 Model Management or the talent and photographers credited, and may not be reused without permission.\n\nSubmitting an application does not guarantee representation.'))))
on conflict (slug) do nothing;

insert into public.website_navigation (location, label, href, sort_order)
select v.location, v.label, v.href, v.sort_order from (values
  ('footer', 'About', '/about', 1), ('footer', 'Join us', '/join', 2), ('footer', 'Privacy', '/privacy', 3), ('footer', 'Terms', '/terms', 4)
) as v(location, label, href, sort_order)
where not exists (select 1 from public.website_navigation);
