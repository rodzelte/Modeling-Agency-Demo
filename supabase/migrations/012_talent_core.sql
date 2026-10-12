-- 012: Talent core.
--
-- * Visibility flags and minor/guardian fields on talent.
-- * Private fields (DOB, contact details, rates, login flags) move to
--   talent_private_details. Data is copied, never deleted: the old talent columns
--   stay in place but are withdrawn from the API with column grants, to be dropped
--   by a later contract migration once staging confirms the copy.
-- * Publication/archive/edit permissions enforced by trigger, so a role that may
--   publish cannot edit other fields and vice versa.
-- * Multi-value phone/email rows and rate rows for the Other tab.

-- ---------------------------------------------------------------------------
-- 1. Visibility and minor fields
-- ---------------------------------------------------------------------------
alter table public.talent
  add column if not exists show_measurements boolean not null default true,
  add column if not exists show_portfolio boolean not null default true,
  add column if not exists show_videos boolean not null default true,
  add column if not exists show_resume boolean not null default false,
  add column if not exists show_comp_card boolean not null default false,
  add column if not exists guardian_required boolean not null default false,
  add column if not exists consent_status text not null default 'not_required',
  add column if not exists guardian_contact_id uuid references public.talent_contacts(id) on delete set null;

alter table public.talent drop constraint if exists talent_publication_status_check;
alter table public.talent add constraint talent_publication_status_check
  check (publication_status in ('draft', 'review', 'published', 'archived')) not valid;
alter table public.talent drop constraint if exists talent_consent_status_check;
alter table public.talent add constraint talent_consent_status_check
  check (consent_status in ('not_required', 'pending', 'granted', 'withdrawn'));

create index if not exists talent_display_name_idx on public.talent (lower(display_name));
create index if not exists talent_status_idx on public.talent (publication_status, updated_at desc);

-- ---------------------------------------------------------------------------
-- 2. Private details
-- ---------------------------------------------------------------------------
alter table public.talent_private_details
  add column if not exists date_of_birth date,
  add column if not exists birth_place text,
  add column if not exists nationality text,
  add column if not exists mobile text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists website text,
  add column if not exists allow_sms boolean not null default false,
  add column if not exists email_icalendar boolean not null default false,
  add column if not exists username text,
  add column if not exists talent_login_enabled boolean not null default false,
  add column if not exists talent_app_enabled boolean not null default false,
  add column if not exists minimum_tariff numeric,
  add column if not exists minimum_hourly_rate numeric,
  add column if not exists minimum_day_rate numeric,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

-- talent.email_icalendar was text in 007; treat any non-empty value as "on".
insert into public.talent_private_details (
  talent_id, date_of_birth, birth_place, nationality, mobile, phone, email, website, allow_sms, email_icalendar,
  username, talent_login_enabled, talent_app_enabled, minimum_tariff, minimum_hourly_rate, minimum_day_rate)
select
  t.id, t.date_of_birth, nullif(t.birth_place, ''), nullif(t.nationality, ''), nullif(t.mobile, ''), nullif(t.phone, ''),
  nullif(t.email, ''), nullif(t.website, ''), t.allow_sms, coalesce(nullif(t.email_icalendar, ''), 'false') not in ('false', 'f', '0', 'no'),
  nullif(t.username, ''), t.talent_login_enabled, t.talent_app_enabled, t.minimum_tariff, t.minimum_hourly_rate, t.minimum_day_rate
from public.talent t
on conflict (talent_id) do update set
  date_of_birth = coalesce(public.talent_private_details.date_of_birth, excluded.date_of_birth),
  birth_place = coalesce(public.talent_private_details.birth_place, excluded.birth_place),
  nationality = coalesce(public.talent_private_details.nationality, excluded.nationality),
  mobile = coalesce(public.talent_private_details.mobile, excluded.mobile),
  phone = coalesce(public.talent_private_details.phone, excluded.phone),
  email = coalesce(public.talent_private_details.email, excluded.email),
  website = coalesce(public.talent_private_details.website, excluded.website),
  username = coalesce(public.talent_private_details.username, excluded.username),
  minimum_tariff = coalesce(public.talent_private_details.minimum_tariff, excluded.minimum_tariff),
  minimum_hourly_rate = coalesce(public.talent_private_details.minimum_hourly_rate, excluded.minimum_hourly_rate),
  minimum_day_rate = coalesce(public.talent_private_details.minimum_day_rate, excluded.minimum_day_rate);

-- Withdraw private columns on talent from the API. Only listed columns are reachable;
-- new talent columns must be added here deliberately (docs/database.md).
revoke select, insert, update on public.talent from anon, authenticated;
grant select (
  id, talent_id, slug, first_name, last_name, display_name, location, gender, date_joined, status,
  publication_status, publish_to_website, show_on_website, show_in_search, featured, show_age,
  show_measurements, show_portfolio, show_videos, show_resume, show_comp_card,
  is_minor, guardian_required, consent_status, guardian_contact_id, public_bio,
  archived_at, created_by, updated_by, created_at, updated_at
) on public.talent to authenticated;
grant insert (
  id, talent_id, slug, first_name, last_name, display_name, location, gender, date_joined, status,
  publication_status, show_on_website, show_in_search, featured, show_age,
  show_measurements, show_portfolio, show_videos, show_resume, show_comp_card,
  is_minor, guardian_required, consent_status, public_bio, created_by, updated_by
) on public.talent to authenticated;
grant update (
  talent_id, slug, first_name, last_name, display_name, location, gender, date_joined, status,
  publication_status, show_on_website, show_in_search, featured, show_age,
  show_measurements, show_portfolio, show_videos, show_resume, show_comp_card,
  is_minor, guardian_required, consent_status, guardian_contact_id, public_bio, archived_at, updated_by, updated_at
) on public.talent to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Publication, archive, and edit enforcement
-- ---------------------------------------------------------------------------
create or replace function public.enforce_talent_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  publication_fields text[] := array['publication_status', 'show_on_website', 'show_in_search', 'featured', 'archived_at', 'publish_to_website'];
  bookkeeping_fields text[] := array['updated_at', 'updated_by'];
begin
  -- Normalise the archive lifecycle.
  if new.publication_status = 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
    new.show_on_website := false;
    new.featured := false;
  elsif tg_op = 'UPDATE' and old.publication_status = 'archived' then
    new.archived_at := null;
  end if;

  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  new.updated_at := now();

  -- Service-role and migration writes are not user actions.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if (new.publication_status in ('published', 'archived') or new.show_on_website) and not public.has_permission('talent.publish') then
      raise exception 'You do not have permission to publish talent' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.publication_status = 'archived') is distinct from (old.publication_status = 'archived')
     and not public.has_permission('talent.archive') then
    raise exception 'You do not have permission to archive or restore talent' using errcode = '42501';
  end if;

  if (new.publication_status is distinct from old.publication_status
      or new.show_on_website is distinct from old.show_on_website
      or new.featured is distinct from old.featured
      or new.show_in_search is distinct from old.show_in_search)
     and not (public.has_permission('talent.publish')
              or (public.has_permission('talent.archive')
                  and (new.publication_status = 'archived' or old.publication_status = 'archived'))) then
    raise exception 'You do not have permission to change publication settings' using errcode = '42501';
  end if;

  if (to_jsonb(new) - publication_fields - bookkeeping_fields) is distinct from (to_jsonb(old) - publication_fields - bookkeeping_fields)
     and not public.has_permission('talent.edit') then
    raise exception 'You do not have permission to edit talent details' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_talent_permissions on public.talent;
create trigger enforce_talent_permissions before insert or update on public.talent
  for each row execute procedure public.enforce_talent_permissions();

-- Private details bookkeeping.
create or replace function public.touch_private_details()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end;
$$;
drop trigger if exists touch_private_details on public.talent_private_details;
create trigger touch_private_details before insert or update on public.talent_private_details
  for each row execute procedure public.touch_private_details();

-- ---------------------------------------------------------------------------
-- 4. Other tab: multiple phone numbers / emails, and rates
-- ---------------------------------------------------------------------------
create table if not exists public.talent_contact_methods (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  kind text not null,
  value text not null,
  label text,
  is_default boolean not null default false,
  add_to_cc boolean not null default false,
  created_at timestamptz not null default now(),
  constraint talent_contact_methods_kind_check check (kind in ('mobile', 'phone', 'email'))
);
create index if not exists talent_contact_methods_talent_idx on public.talent_contact_methods (talent_id, kind);

create table if not exists public.talent_rates (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  rate_type text not null,
  amount numeric not null check (amount >= 0),
  currency text not null default 'USD',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists talent_rates_talent_idx on public.talent_rates (talent_id);

alter table public.talent_contact_methods enable row level security;
alter table public.talent_rates enable row level security;
revoke all on public.talent_contact_methods, public.talent_rates from anon;

drop policy if exists "private readers read contact methods" on public.talent_contact_methods;
create policy "private readers read contact methods" on public.talent_contact_methods for select to authenticated
  using (public.has_permission('talent.private.view') or talent_id = public.current_talent_id());
drop policy if exists "private editors manage contact methods" on public.talent_contact_methods;
create policy "private editors manage contact methods" on public.talent_contact_methods for all to authenticated
  using (public.has_permission('talent.private.edit')) with check (public.has_permission('talent.private.edit'));

drop policy if exists "private readers read rates" on public.talent_rates;
create policy "private readers read rates" on public.talent_rates for select to authenticated
  using (public.has_permission('talent.private.view'));
drop policy if exists "private editors manage rates" on public.talent_rates;
create policy "private editors manage rates" on public.talent_rates for all to authenticated
  using (public.has_permission('talent.private.edit')) with check (public.has_permission('talent.private.edit'));

-- Notes can be removed by their editors (corrections), and carry an update time.
alter table public.talent_notes add column if not exists updated_at timestamptz not null default now();
drop policy if exists "note editors delete notes" on public.talent_notes;
create policy "note editors delete notes" on public.talent_notes for delete to authenticated using (public.has_permission('notes.edit'));

-- Removals of sub-records are useful in the dashboard and for the talent-portal later.
drop policy if exists "private editors delete private details" on public.talent_private_details;
create policy "private editors delete private details" on public.talent_private_details for delete to authenticated
  using (public.has_permission('talent.private.edit'));
