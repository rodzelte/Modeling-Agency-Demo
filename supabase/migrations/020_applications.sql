-- 020: Applications (Join Us), fed from GoHighLevel.
--
-- The public "Join us" form stays on GHL (funnel.modelluxemedia.com). A GHL
-- workflow webhook and a one-off import script post each submission to
-- /api/integrations/ghl, which writes here with the server-only secret key.
-- Staff review applications in the dashboard and convert them into draft talent
-- without re-entering anything.
--
-- * applications / application_photos / application_notes, readable only with
--   applications.view; nothing is readable or writable by anon.
-- * Photos live in the private "applications" bucket.
-- * convert_application() creates the draft talent, private details and
--   measurements in one transaction, as the calling staff member (RLS applies).
-- * Status changes and conversions are audited by trigger.

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module, description) values
  ('applications.view', 'applications', 'View Join Us applications and their photos'),
  ('applications.manage', 'applications', 'Review, annotate, and convert applications')
on conflict (key) do nothing;

insert into public.role_permissions (role_key, permission_key)
select v.role_key, v.permission_key
from (values
  ('owner', 'applications.view'), ('owner', 'applications.manage'),
  ('administrator', 'applications.view'), ('administrator', 'applications.manage'),
  ('talent_manager', 'applications.view'), ('talent_manager', 'applications.manage'),
  ('booker', 'applications.view')
) as v(role_key, permission_key)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'ghl' check (source in ('ghl', 'manual')),
  external_id text,
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'info_requested', 'approved', 'rejected', 'archived', 'converted')),
  first_name text,
  last_name text,
  email text,
  phone text,
  date_of_birth date,
  gender text,
  address text,
  city text,
  state text,
  postal_code text,
  country text,
  instagram text,
  height_cm numeric,
  bust_cm numeric,
  waist_cm numeric,
  hips_cm numeric,
  dress_size text,
  shoe_size text,
  hair_color text,
  eye_color text,
  message text,
  is_minor boolean not null default false,
  guardian_name text,
  guardian_email text,
  guardian_phone text,
  sms_consent boolean,
  sms_consent_text text,
  extra_fields jsonb not null default '{}'::jsonb,
  raw_payload jsonb,
  submitted_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  converted_talent_id uuid references public.talent(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists applications_source_external_idx on public.applications (source, external_id) where external_id is not null;
create index if not exists applications_status_idx on public.applications (status, submitted_at desc);
create index if not exists applications_email_idx on public.applications (lower(email));

create table if not exists public.application_photos (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  kind text not null default 'other' check (kind in ('full_body', 'headshot', 'three_quarter', 'other')),
  storage_path text,
  source_url text,
  content_type text,
  size_bytes bigint,
  status text not null default 'stored' check (status in ('stored', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists application_photos_application_idx on public.application_photos (application_id, created_at);
create unique index if not exists application_photos_source_idx on public.application_photos (application_id, source_url) where source_url is not null;

create table if not exists public.application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists application_notes_application_idx on public.application_notes (application_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.applications enable row level security;
alter table public.application_photos enable row level security;
alter table public.application_notes enable row level security;
revoke all on public.applications, public.application_photos, public.application_notes from anon;
-- raw_payload is kept for troubleshooting only and is not readable through the API.
revoke select on public.applications from authenticated;
grant select (id, source, external_id, status, first_name, last_name, email, phone, date_of_birth, gender, address, city,
  state, postal_code, country, instagram, height_cm, bust_cm, waist_cm, hips_cm, dress_size, shoe_size, hair_color,
  eye_color, message, is_minor, guardian_name, guardian_email, guardian_phone, sms_consent, sms_consent_text,
  extra_fields, submitted_at, last_received_at, reviewed_by, reviewed_at, converted_talent_id, converted_at,
  created_at, updated_at) on public.applications to authenticated;
revoke insert, update, delete on public.applications from authenticated;
grant update (status) on public.applications to authenticated;
revoke insert, update, delete on public.application_photos from authenticated;
revoke update, delete on public.application_notes from authenticated;

drop policy if exists "application readers read applications" on public.applications;
create policy "application readers read applications" on public.applications for select to authenticated
  using (public.has_permission('applications.view'));
drop policy if exists "application managers update applications" on public.applications;
create policy "application managers update applications" on public.applications for update to authenticated
  using (public.has_permission('applications.manage')) with check (public.has_permission('applications.manage'));

drop policy if exists "application readers read photos" on public.application_photos;
create policy "application readers read photos" on public.application_photos for select to authenticated
  using (public.has_permission('applications.view'));

drop policy if exists "application readers read notes" on public.application_notes;
create policy "application readers read notes" on public.application_notes for select to authenticated
  using (public.has_permission('applications.view'));
drop policy if exists "application managers add notes" on public.application_notes;
create policy "application managers add notes" on public.application_notes for insert to authenticated
  with check (public.has_permission('applications.manage') and author_id = auth.uid());

-- Storage: staff read application photos; only the server (secret key) writes them.
drop policy if exists "application readers read application files" on storage.objects;
create policy "application readers read application files" on storage.objects for select to authenticated
  using (bucket_id = 'applications' and public.has_permission('applications.view'));

-- ---------------------------------------------------------------------------
-- 4. Bookkeeping and audit
-- ---------------------------------------------------------------------------
create or replace function public.prepare_application()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.date_of_birth is not null then
    new.is_minor := new.date_of_birth > (current_date - interval '18 years');
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and auth.uid() is not null then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    -- Converted is set only by convert_application().
    if new.status = 'converted' and old.status <> 'converted' and new.converted_talent_id is null then
      raise exception 'Use Convert to talent to convert an application' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prepare_application on public.applications;
create trigger prepare_application before insert or update on public.applications
  for each row execute function public.prepare_application();

create or replace function public.audit_application()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'application.received', 'application', new.id, jsonb_build_object('source', new.source));
  elsif new.status is distinct from old.status then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, metadata)
    values (auth.uid(),
      case when new.status = 'converted' then 'application.converted' else 'application.status_changed' end,
      'application', new.id,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status),
      case when new.converted_talent_id is not null then jsonb_build_object('talent_id', new.converted_talent_id) else '{}'::jsonb end);
  end if;
  return new;
end;
$$;

drop trigger if exists audit_application on public.applications;
create trigger audit_application after insert or update on public.applications
  for each row execute function public.audit_application();

revoke execute on function public.prepare_application(), public.audit_application() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Conversion
-- ---------------------------------------------------------------------------
-- Checks that the caller holds applications.manage, talent.create and
-- talent.private.edit, then creates the draft talent and its details in one
-- transaction. The talent permission trigger still sees the caller (auth.uid()),
-- and the talent is created as an unpublished draft. Returns the new talent id.
-- Photos are copied into talent-private by the app afterwards.
create or replace function public.convert_application(p_application_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  app public.applications%rowtype;
  new_talent uuid;
  base_slug text;
  display text;
begin
  if not (public.has_permission('applications.manage') and public.has_permission('talent.create') and public.has_permission('talent.private.edit')) then
    raise exception 'You do not have permission to convert applications' using errcode = '42501';
  end if;

  select * into app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if app.status = 'converted' then
    return app.converted_talent_id;
  end if;

  display := nullif(trim(concat_ws(' ', app.first_name, app.last_name)), '');
  display := coalesce(display, 'New applicant');
  base_slug := trim(both '-' from regexp_replace(lower(display), '[^a-z0-9]+', '-', 'g'));
  base_slug := coalesce(nullif(base_slug, ''), 'talent') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.talent (slug, first_name, last_name, display_name, location, gender, publication_status,
    show_on_website, is_minor, guardian_required, consent_status, date_joined)
  values (base_slug, coalesce(nullif(app.first_name, ''), display), coalesce(app.last_name, ''), display,
    nullif(concat_ws(', ', nullif(app.city, ''), nullif(app.state, '')), ''), app.gender, 'draft', false,
    app.is_minor, app.is_minor, case when app.is_minor then 'pending' else 'not_required' end, current_date)
  returning id into new_talent;

  insert into public.talent_private_details (talent_id, date_of_birth, mobile, email, allow_sms)
  values (new_talent, app.date_of_birth, app.phone, app.email, coalesce(app.sms_consent, false))
  on conflict (talent_id) do update set
    date_of_birth = excluded.date_of_birth, mobile = excluded.mobile, email = excluded.email, allow_sms = excluded.allow_sms;

  if coalesce(app.height_cm, app.bust_cm, app.waist_cm, app.hips_cm) is not null
     or app.hair_color is not null or app.eye_color is not null then
    insert into public.talent_measurements (talent_id, height_cm, bust_chest_cm, waist_cm, hips_cm, hair_color, eye_color, notes)
    values (new_talent, app.height_cm, app.bust_cm, app.waist_cm, app.hips_cm, app.hair_color, app.eye_color,
      'From application ' || to_char(app.submitted_at, 'YYYY-MM-DD'));
  end if;

  if nullif(app.address, '') is not null or nullif(app.city, '') is not null then
    insert into public.talent_addresses (talent_id, label, address_1, city, state, postal_code, country, is_main)
    values (new_talent, 'Home', app.address, app.city, app.state, app.postal_code, app.country, true);
  end if;

  if nullif(app.instagram, '') is not null then
    insert into public.talent_social_accounts (talent_id, platform, handle)
    values (new_talent, 'instagram', app.instagram);
  end if;

  if nullif(app.guardian_name, '') is not null or nullif(app.guardian_email, '') is not null then
    insert into public.talent_contacts (talent_id, name, relationship, email, phone)
    values (new_talent, coalesce(nullif(app.guardian_name, ''), 'Guardian'), 'guardian', app.guardian_email, app.guardian_phone);
  end if;

  insert into public.talent_notes (talent_id, created_by, body)
  values (new_talent, auth.uid(), concat_ws(E'\n', 'Converted from a Join Us application (' || app.source || ').',
    case when nullif(app.message, '') is not null then 'Applicant message: ' || app.message end,
    case when app.dress_size is not null or app.shoe_size is not null
         then 'Dress size: ' || coalesce(app.dress_size, '—') || ' · Shoe size: ' || coalesce(app.shoe_size, '—') end));

  update public.applications
  set status = 'converted', converted_talent_id = new_talent, converted_at = now()
  where id = app.id;

  return new_talent;
end;
$$;

revoke execute on function public.convert_application(uuid) from public, anon;
grant execute on function public.convert_application(uuid) to authenticated;

-- Retention: deletes rejected/archived applications (with their notes and photo
-- rows) older than the given age and returns the storage paths so the caller can
-- remove the files. Owner only. See docs/operations.md.
create or replace function public.purge_stale_applications(p_older_than interval default interval '12 months')
returns table (application_id uuid, storage_path text) language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('team.manage') then
    raise exception 'Only the owner can purge applications' using errcode = '42501';
  end if;
  return query
  with doomed as (
    select a.id from public.applications a
    where a.status in ('rejected', 'archived') and a.updated_at < now() - p_older_than
  ),
  paths as (
    select p.application_id, p.storage_path from public.application_photos p
    join doomed d on d.id = p.application_id where p.storage_path is not null
  ),
  removed as (
    delete from public.applications a using doomed d where a.id = d.id returning a.id
  )
  select r.id, p.storage_path from removed r left join paths p on p.application_id = r.id;

  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (auth.uid(), 'application.purged', 'application', jsonb_build_object('older_than', p_older_than::text));
end;
$$;

revoke execute on function public.purge_stale_applications(interval) from public, anon;
grant execute on function public.purge_stale_applications(interval) to authenticated;
