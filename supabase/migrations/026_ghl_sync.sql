-- 026: GoHighLevel sync.
--
-- GHL stays the CRM; this system mirrors it and owns talent, media and the
-- website. Everything here is written by the server with the secret key
-- (src/lib/supabase/admin.ts) and read by staff holding integrations.view.
--
-- * Mirror: ghl_contacts, ghl_opportunities (+ history), ghl_pipelines,
--   ghl_pipeline_stages, ghl_field_definitions, ghl_custom_values, ghl_users.
--   Every row keeps its GHL id and the raw GHL record, so no field is lost even
--   before it is mapped.
-- * Configuration staff can edit: pipeline purpose, stage -> normalized status,
--   field -> dashboard target and ownership, tag/field status rules, which
--   statuses get a talent record, and whether edits are written back to GHL.
-- * Bookkeeping: ghl_sync_jobs (queue with retries and a dead-letter state),
--   ghl_sync_runs, ghl_webhook_events, ghl_sync_conflicts, ghl_field_state
--   (last value both sides agreed on, used for loop prevention and conflicts).
-- * One talent per GHL contact: ghl_contacts.talent_id is unique, and
--   ghl_link_talent() matches by GHL id first, then a converted application,
--   then email/phone together with the first name, before creating a draft.
-- * talent.crm_status (normalized CRM status) is separate from
--   publication_status; the website never reads ghl_* tables.

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module, description) values
  ('integrations.view', 'integrations', 'View GHL sync status and the CRM data mirrored from GoHighLevel'),
  ('integrations.manage', 'integrations', 'Run GHL syncs, edit field and status mappings, and resolve sync conflicts')
on conflict (key) do nothing;

insert into public.role_permissions (role_key, permission_key)
select v.role_key, v.permission_key
from (values
  ('owner', 'integrations.view'), ('owner', 'integrations.manage'),
  ('administrator', 'integrations.view'), ('administrator', 'integrations.manage'),
  ('talent_manager', 'integrations.view')
) as v(role_key, permission_key)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists public.ghl_settings (
  id boolean primary key default true check (id),
  -- Contacts whose CRM status is in this list get (or keep) a talent record.
  talent_statuses text[] not null default array['enrolled', 'active', 'booked', 'graduated'],
  -- Dashboard edits to bidirectional fields are pushed to GHL only when on.
  writeback_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (talent_statuses <@ array['lead', 'applicant', 'screening', 'accepted', 'enrolled', 'active', 'booked', 'graduated', 'inactive', 'rejected', 'archived'])
);
insert into public.ghl_settings (id) values (true) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Catalogue: pipelines, stages, fields, custom values, users
-- ---------------------------------------------------------------------------
create table if not exists public.ghl_pipelines (
  id text primary key,
  name text not null,
  -- talent: stages decide a person's CRM status. client: sales to clients, ignored
  -- for talent status. ignore: stored only. null: new, waiting for review.
  purpose text check (purpose in ('talent', 'client', 'ignore')),
  -- Short tag shown on talent in the dashboard ("Model Expo", "Talent Recruitment")
  -- when they qualify through this pipeline (enrolled, active, ...).
  badge_label text check (length(badge_label) between 1 and 30),
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.ghl_pipeline_stages (
  id text primary key,
  pipeline_id text not null references public.ghl_pipelines(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  normalized_status text check (normalized_status in ('lead', 'applicant', 'screening', 'accepted', 'enrolled', 'active', 'booked', 'graduated', 'inactive', 'rejected', 'archived')),
  mapping_source text check (mapping_source in ('initial', 'staff')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ghl_pipeline_stages_pipeline_idx on public.ghl_pipeline_stages (pipeline_id, position);

create table if not exists public.ghl_field_definitions (
  id text primary key,
  object_key text not null,
  name text not null,
  field_key text,
  data_type text,
  options jsonb,
  -- Where the value lands in the dashboard; null keeps it as CRM data only.
  target text check (target in (
    'gender', 'location', 'date_of_birth', 'instagram', 'tiktok', 'youtube',
    'height_cm', 'bust_cm', 'waist_cm', 'hips_cm', 'weight_kg', 'shoe_size', 'shirt_size', 'pants_size', 'dress_size',
    'hair_color', 'eye_color', 'ethnicity',
    'photo_headshot', 'photo_three_quarter', 'photo_full_body', 'photo_gallery')),
  ownership text not null default 'ghl_only' check (ownership in ('ghl_only', 'dashboard_only', 'bidirectional')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ghl_field_definitions_object_idx on public.ghl_field_definitions (object_key, name);

create table if not exists public.ghl_custom_values (
  id text primary key,
  name text not null,
  field_key text,
  value text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.ghl_users (
  id text primary key,
  name text,
  email text,
  role text,
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz
);

-- Extra ways to derive a CRM status besides the pipeline stage.
create table if not exists public.ghl_status_rules (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('tag', 'contact_field')),
  field_id text,
  match_value text not null check (length(match_value) between 1 and 200),
  normalized_status text not null check (normalized_status in ('lead', 'applicant', 'screening', 'accepted', 'enrolled', 'active', 'booked', 'graduated', 'inactive', 'rejected', 'archived')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check ((kind = 'tag') = (field_id is null))
);
create unique index if not exists ghl_status_rules_unique_idx on public.ghl_status_rules (kind, coalesce(field_id, ''), lower(match_value));

-- ---------------------------------------------------------------------------
-- 4. Mirror: contacts and opportunities
-- ---------------------------------------------------------------------------
create table if not exists public.ghl_contacts (
  id text primary key,
  first_name text,
  last_name text,
  email text,
  phone text,
  date_of_birth date,
  contact_type text,
  source text,
  tags text[] not null default '{}',
  assigned_to text,
  address_1 text,
  city text,
  state text,
  postal_code text,
  country text,
  -- { "<field id>": <value as GHL returns it> } for every custom field.
  custom_fields jsonb not null default '{}'::jsonb,
  raw jsonb,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  full_fetched_at timestamptz,
  synced_at timestamptz not null default now(),
  crm_status text check (crm_status in ('lead', 'applicant', 'screening', 'accepted', 'enrolled', 'active', 'booked', 'graduated', 'inactive', 'rejected', 'archived')),
  crm_status_reason text,
  -- Badge labels of the pipelines through which the contact qualifies as talent.
  programs text[] not null default '{}',
  talent_id uuid unique references public.talent(id) on delete set null,
  -- Set when staff delete the linked talent, so the sync does not recreate it.
  auto_create_blocked boolean not null default false,
  removed_at timestamptz
);
create index if not exists ghl_contacts_email_idx on public.ghl_contacts (lower(email));
create index if not exists ghl_contacts_status_idx on public.ghl_contacts (crm_status);
create index if not exists ghl_contacts_updated_idx on public.ghl_contacts (source_updated_at desc);
create index if not exists ghl_contacts_name_idx on public.ghl_contacts (lower(first_name), lower(last_name));

create table if not exists public.ghl_opportunities (
  id text primary key,
  contact_id text not null,
  pipeline_id text not null,
  stage_id text,
  name text,
  status text,
  monetary_value numeric,
  source text,
  assigned_to text,
  custom_fields jsonb not null default '{}'::jsonb,
  raw jsonb,
  last_stage_change_at timestamptz,
  last_status_change_at timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists ghl_opportunities_contact_idx on public.ghl_opportunities (contact_id);
create index if not exists ghl_opportunities_stage_idx on public.ghl_opportunities (pipeline_id, stage_id);

-- Stage/status changes as the sync observes them (GHL's API has no history).
create table if not exists public.ghl_opportunity_history (
  id uuid primary key default gen_random_uuid(),
  opportunity_id text not null,
  contact_id text not null,
  pipeline_id text,
  from_stage_id text,
  to_stage_id text,
  from_status text,
  to_status text,
  changed_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index if not exists ghl_opportunity_history_contact_idx on public.ghl_opportunity_history (contact_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- 5. Sync bookkeeping
-- ---------------------------------------------------------------------------
create table if not exists public.ghl_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('contact', 'push_contact')),
  external_id text not null check (length(external_id) between 1 and 100),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
-- At most one open job per record: repeated webhooks collapse into one.
create unique index if not exists ghl_sync_jobs_open_idx on public.ghl_sync_jobs (kind, external_id) where status in ('pending', 'running', 'failed');
create index if not exists ghl_sync_jobs_due_idx on public.ghl_sync_jobs (status, next_attempt_at);

create table if not exists public.ghl_sync_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('reconcile', 'discovery')),
  trigger text not null check (trigger in ('cron', 'dashboard', 'script', 'webhook')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  cursor jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  error text,
  triggered_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ghl_sync_runs_started_idx on public.ghl_sync_runs (kind, started_at desc);

create table if not exists public.ghl_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  event text,
  contact_id text,
  opportunity_id text,
  outcome text not null
);
create index if not exists ghl_webhook_events_received_idx on public.ghl_webhook_events (received_at desc);

create table if not exists public.ghl_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  contact_id text not null,
  target text not null,
  base_value text,
  dashboard_value text,
  ghl_value text,
  status text not null default 'open' check (status in ('open', 'kept_dashboard', 'took_ghl', 'dismissed')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create unique index if not exists ghl_sync_conflicts_open_idx on public.ghl_sync_conflicts (talent_id, target) where status = 'open';

create table if not exists public.ghl_field_state (
  talent_id uuid not null references public.talent(id) on delete cascade,
  target text not null,
  value text,
  source text not null check (source in ('ghl', 'dashboard')),
  synced_at timestamptz not null default now(),
  primary key (talent_id, target)
);

-- ---------------------------------------------------------------------------
-- 6. Talent, photo and measurement additions
-- ---------------------------------------------------------------------------
alter table public.talent add column if not exists crm_status text
  check (crm_status in ('lead', 'applicant', 'screening', 'accepted', 'enrolled', 'active', 'booked', 'graduated', 'inactive', 'rejected', 'archived'));
-- Pipeline tags such as "Model Expo" / "Talent Recruitment", shown in the dashboard.
alter table public.talent add column if not exists crm_programs text[] not null default '{}';
-- Staff may read them; only the sync writes them (GHL owns CRM status). Anon never sees them.
grant select (crm_status, crm_programs) on public.talent to authenticated;

alter table public.talent_photos
  add column if not exists source text not null default 'upload' check (source in ('upload', 'portal', 'application', 'ghl')),
  add column if not exists external_id text,
  add column if not exists source_url text,
  add column if not exists photo_role text check (photo_role in ('headshot', 'three_quarter', 'full_body')),
  add column if not exists content_sha256 text,
  add column if not exists synced_at timestamptz;
-- A GHL file is stored once per talent, however often the contact syncs.
create unique index if not exists talent_photos_external_idx on public.talent_photos (talent_id, external_id) where external_id is not null;

alter table public.talent_measurements
  add column if not exists shirt_size text,
  add column if not exists pants_size text,
  add column if not exists dress_size text,
  add column if not exists source text not null default 'staff' check (source in ('staff', 'ghl', 'portal', 'application'));

-- ---------------------------------------------------------------------------
-- 7. Row-level security
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['ghl_settings', 'ghl_pipelines', 'ghl_pipeline_stages', 'ghl_field_definitions', 'ghl_custom_values', 'ghl_users',
    'ghl_status_rules', 'ghl_contacts', 'ghl_opportunities', 'ghl_opportunity_history', 'ghl_sync_jobs', 'ghl_sync_runs',
    'ghl_webhook_events', 'ghl_sync_conflicts', 'ghl_field_state']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('drop policy if exists "integration readers" on public.%I', t);
    execute format('create policy "integration readers" on public.%I for select to authenticated using (public.has_permission(''integrations.view''))', t);
  end loop;
end $$;

-- Raw GHL payloads stay server-side (they hold signed file links and every field).
revoke select on public.ghl_contacts, public.ghl_opportunities, public.ghl_pipelines, public.ghl_field_definitions from authenticated;
grant select (id, first_name, last_name, email, phone, date_of_birth, contact_type, source, tags, assigned_to, address_1, city, state,
  postal_code, country, custom_fields, source_created_at, source_updated_at, full_fetched_at, synced_at, crm_status, crm_status_reason,
  programs, talent_id, auto_create_blocked, removed_at) on public.ghl_contacts to authenticated;
grant select (id, contact_id, pipeline_id, stage_id, name, status, monetary_value, source, assigned_to, custom_fields,
  last_stage_change_at, last_status_change_at, source_created_at, source_updated_at, synced_at, removed_at) on public.ghl_opportunities to authenticated;
grant select (id, name, purpose, badge_label, first_seen_at, last_seen_at, removed_at, updated_at) on public.ghl_pipelines to authenticated;
grant select (id, object_key, name, field_key, data_type, options, target, ownership, reviewed_at, reviewed_by,
  first_seen_at, last_seen_at, removed_at, updated_at) on public.ghl_field_definitions to authenticated;

-- What staff with integrations.manage may change (every change is audited below).
grant update (purpose, badge_label, updated_at) on public.ghl_pipelines to authenticated;
grant update (normalized_status, mapping_source, updated_at) on public.ghl_pipeline_stages to authenticated;
grant update (target, ownership, reviewed_at, reviewed_by, updated_at) on public.ghl_field_definitions to authenticated;
grant update (talent_statuses, writeback_enabled, updated_by, updated_at) on public.ghl_settings to authenticated;
grant insert (kind, field_id, match_value, normalized_status), delete on public.ghl_status_rules to authenticated;
grant update (status, resolved_at, resolved_by) on public.ghl_sync_conflicts to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['ghl_pipelines', 'ghl_pipeline_stages', 'ghl_field_definitions', 'ghl_settings', 'ghl_sync_conflicts']
  loop
    execute format('drop policy if exists "integration managers update" on public.%I', t);
    execute format('create policy "integration managers update" on public.%I for update to authenticated using (public.has_permission(''integrations.manage'')) with check (public.has_permission(''integrations.manage''))', t);
  end loop;
end $$;
drop policy if exists "integration managers add rules" on public.ghl_status_rules;
create policy "integration managers add rules" on public.ghl_status_rules for insert to authenticated
  with check (public.has_permission('integrations.manage'));
drop policy if exists "integration managers remove rules" on public.ghl_status_rules;
create policy "integration managers remove rules" on public.ghl_status_rules for delete to authenticated
  using (public.has_permission('integrations.manage'));

-- ---------------------------------------------------------------------------
-- 8. Audit and bookkeeping triggers
-- ---------------------------------------------------------------------------
-- Configuration changes by staff are audited (setting names and new values;
-- conflicts record only the field and the resolution, never personal values).
create or replace function public.audit_ghl_config()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changes jsonb;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_table_name = 'ghl_sync_conflicts' then
    changes := jsonb_build_object('target', to_jsonb(new) ->> 'target', 'resolution', to_jsonb(new) ->> 'status');
  elsif tg_op = 'DELETE' then
    changes := to_jsonb(old) - 'created_by' - 'created_at';
  else
    changes := (select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) from jsonb_each(to_jsonb(new)) n
                where tg_op = 'INSERT' or n.value is distinct from (to_jsonb(old) -> n.key))
               - 'updated_at' - 'updated_by' - 'reviewed_by' - 'resolved_by' - 'raw';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (auth.uid(), 'ghl.config_changed', tg_table_name,
    jsonb_build_object('id', coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'), 'operation', lower(tg_op), 'changes', changes));
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['ghl_pipelines', 'ghl_pipeline_stages', 'ghl_field_definitions', 'ghl_settings', 'ghl_status_rules', 'ghl_sync_conflicts']
  loop
    execute format('drop trigger if exists audit_ghl_config on public.%I', t);
    execute format('create trigger audit_ghl_config after insert or update or delete on public.%I for each row execute function public.audit_ghl_config()', t);
  end loop;
end $$;

-- Staff edits are stamped; a staff-changed stage mapping is marked as such.
create or replace function public.stamp_ghl_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  -- Nested IFs: a column is only referenced on the table that has it.
  if auth.uid() is not null then
    if tg_table_name = 'ghl_settings' then
      new.updated_by := auth.uid();
    elsif tg_table_name = 'ghl_pipeline_stages' then
      if new.normalized_status is distinct from old.normalized_status then new.mapping_source := 'staff'; end if;
    elsif tg_table_name = 'ghl_field_definitions' then
      if new.target is distinct from old.target or new.ownership is distinct from old.ownership or new.reviewed_at is distinct from old.reviewed_at then
        new.reviewed_at := coalesce(new.reviewed_at, now());
        new.reviewed_by := auth.uid();
      end if;
    end if;
  end if;
  return new;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['ghl_pipelines', 'ghl_pipeline_stages', 'ghl_field_definitions', 'ghl_settings']
  loop
    execute format('drop trigger if exists stamp_ghl_config on public.%I', t);
    execute format('create trigger stamp_ghl_config before update on public.%I for each row execute function public.stamp_ghl_config()', t);
  end loop;
end $$;

-- Resolving a conflict stamps who did it.
create or replace function public.stamp_ghl_conflict()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status <> 'open' then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists stamp_ghl_conflict on public.ghl_sync_conflicts;
create trigger stamp_ghl_conflict before update on public.ghl_sync_conflicts for each row execute function public.stamp_ghl_conflict();

-- Deleting a linked talent blocks the sync from creating it again; linking and
-- unlinking are audited.
create or replace function public.track_ghl_talent_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.talent_id is not null and new.talent_id is null then
    new.auto_create_blocked := true;
  end if;
  if new.talent_id is distinct from old.talent_id then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), case when new.talent_id is null then 'talent.unlinked_from_ghl' else 'talent.linked_to_ghl' end, 'talent',
      coalesce(new.talent_id, old.talent_id), jsonb_build_object('ghl_contact_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists track_ghl_talent_link on public.ghl_contacts;
create trigger track_ghl_talent_link before update of talent_id on public.ghl_contacts for each row execute function public.track_ghl_talent_link();

-- Dashboard edits to synced talent data queue a push to GHL (only when write-back
-- is on). Writes by the sync itself (no auth.uid()) never queue, which is what
-- stops GHL -> dashboard -> GHL loops; ghl_field_state stops the echo of a push.
create or replace function public.queue_ghl_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  row_data jsonb := to_jsonb(coalesce(new, old));
  target_talent uuid;
begin
  if auth.uid() is null or not coalesce((select writeback_enabled from public.ghl_settings), false) then
    return null;
  end if;
  target_talent := case when tg_table_name = 'talent' then (row_data ->> 'id')::uuid else (row_data ->> 'talent_id')::uuid end;
  insert into public.ghl_sync_jobs (kind, external_id, reason)
  select 'push_contact', c.id, 'dashboard edit: ' || tg_table_name
  from public.ghl_contacts c where c.talent_id = target_talent
  on conflict (kind, external_id) where status in ('pending', 'running', 'failed') do nothing;
  return null;
end;
$$;
drop trigger if exists queue_ghl_push on public.talent;
create trigger queue_ghl_push after update of first_name, last_name, gender, location on public.talent
  for each row execute function public.queue_ghl_push();
drop trigger if exists queue_ghl_push on public.talent_private_details;
create trigger queue_ghl_push after insert or update of email, mobile, phone, date_of_birth on public.talent_private_details
  for each row execute function public.queue_ghl_push();
drop trigger if exists queue_ghl_push on public.talent_measurements;
create trigger queue_ghl_push after insert on public.talent_measurements
  for each row execute function public.queue_ghl_push();
drop trigger if exists queue_ghl_push on public.talent_social_accounts;
create trigger queue_ghl_push after insert or update on public.talent_social_accounts
  for each row execute function public.queue_ghl_push();

revoke execute on function public.audit_ghl_config(), public.stamp_ghl_config(), public.stamp_ghl_conflict(),
  public.track_ghl_talent_link(), public.queue_ghl_push() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. One talent per GHL contact
-- ---------------------------------------------------------------------------
-- Returns the talent linked to a GHL contact, linking an existing one when it is
-- unambiguous and creating a private draft when p_create is true.
--   1. already linked (GHL contact id is the primary identifier);
--   2. a Join Us application for the same GHL contact that was converted;
--   3. exactly one unlinked talent with the same email or phone AND first name
--      (email alone is not enough: siblings often share a parent's email).
-- Any open application for the contact is closed as converted, so "Convert to
-- talent" can never create a second record. Called by the sync (secret key) or
-- by staff holding integrations.manage, talent.create and talent.private.edit.
create or replace function public.ghl_link_talent(p_contact_id text, p_create boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.ghl_contacts%rowtype;
  found_id uuid;
  candidates uuid[];
  phone_digits text;
  display text;
  base_slug text;
begin
  if auth.uid() is not null and not (public.has_permission('integrations.manage') and public.has_permission('talent.create') and public.has_permission('talent.private.edit')) then
    raise exception 'You do not have permission to link GHL contacts to talent' using errcode = '42501';
  end if;

  select * into c from public.ghl_contacts where id = p_contact_id for update;
  if not found then raise exception 'GHL contact not found' using errcode = 'P0002'; end if;
  if c.talent_id is not null then return c.talent_id; end if;

  select a.converted_talent_id into found_id from public.applications a
  where a.source = 'ghl' and a.external_id = c.id and a.converted_talent_id is not null
    and not exists (select 1 from public.ghl_contacts x where x.talent_id = a.converted_talent_id)
  order by a.converted_at desc nulls last limit 1;

  if found_id is null then
    phone_digits := nullif(right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 10), '');
    if length(phone_digits) < 10 then phone_digits := null; end if;
    select array_agg(t.id) into candidates
    from public.talent t join public.talent_private_details pd on pd.talent_id = t.id
    where t.archived_at is null
      and nullif(trim(c.first_name), '') is not null
      and lower(trim(t.first_name)) = lower(trim(c.first_name))
      and ((nullif(c.email, '') is not null and lower(pd.email) = lower(c.email))
        or (phone_digits is not null and (right(regexp_replace(coalesce(pd.mobile, ''), '[^0-9]', '', 'g'), 10) = phone_digits
                                       or right(regexp_replace(coalesce(pd.phone, ''), '[^0-9]', '', 'g'), 10) = phone_digits)))
      and not exists (select 1 from public.ghl_contacts x where x.talent_id = t.id);
    if coalesce(array_length(candidates, 1), 0) = 1 then found_id := candidates[1]; end if;
  end if;

  if found_id is null and p_create then
    display := coalesce(nullif(trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.last_name), ''))), ''), 'GHL contact');
    base_slug := trim(both '-' from regexp_replace(lower(display), '[^a-z0-9]+', '-', 'g'));
    base_slug := coalesce(nullif(base_slug, ''), 'talent') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    insert into public.talent (slug, first_name, last_name, display_name, publication_status, show_on_website, date_joined, crm_status, crm_programs)
    values (base_slug, coalesce(nullif(trim(c.first_name), ''), display), coalesce(trim(c.last_name), ''), display, 'draft', false, current_date, c.crm_status, c.programs)
    returning id into found_id;
    insert into public.talent_private_details (talent_id) values (found_id) on conflict (talent_id) do nothing;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'talent.created', 'talent', found_id, jsonb_build_object('source', 'ghl', 'ghl_contact_id', c.id));
  end if;

  if found_id is null then return null; end if;

  update public.ghl_contacts set talent_id = found_id, auto_create_blocked = false where id = c.id;
  update public.talent set crm_status = c.crm_status, crm_programs = c.programs
  where id = found_id and (crm_status is distinct from c.crm_status or crm_programs is distinct from c.programs);
  update public.applications set status = 'converted', converted_talent_id = found_id, converted_at = coalesce(converted_at, now())
  where source = 'ghl' and external_id = c.id and status <> 'converted';
  return found_id;
end;
$$;
revoke execute on function public.ghl_link_talent(text, boolean) from public, anon;
grant execute on function public.ghl_link_talent(text, boolean) to authenticated, service_role;

-- convert_application(): unchanged, except that an application whose GHL contact
-- already has a talent record links to it instead of creating a duplicate.
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

  if app.source = 'ghl' and app.external_id is not null then
    select gc.talent_id into new_talent from public.ghl_contacts gc where gc.id = app.external_id and gc.talent_id is not null;
    if new_talent is not null then
      update public.applications set status = 'converted', converted_talent_id = new_talent, converted_at = now() where id = app.id;
      return new_talent;
    end if;
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
    insert into public.talent_measurements (talent_id, height_cm, bust_chest_cm, waist_cm, hips_cm, hair_color, eye_color, notes, source)
    values (new_talent, app.height_cm, app.bust_cm, app.waist_cm, app.hips_cm, app.hair_color, app.eye_color,
      'From application ' || to_char(app.submitted_at, 'YYYY-MM-DD'), 'application');
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

  -- A GHL contact already mirrored for this application points at the new talent.
  if app.source = 'ghl' and app.external_id is not null then
    update public.ghl_contacts set talent_id = new_talent where id = app.external_id and talent_id is null;
  end if;

  return new_talent;
end;
$$;
revoke execute on function public.convert_application(uuid) from public, anon;
grant execute on function public.convert_application(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Queue helpers for the server (secret key only)
-- ---------------------------------------------------------------------------
-- Claims up to p_limit due jobs atomically, so overlapping runs never process the
-- same job twice. Jobs stuck in "running" for 10 minutes are claimed again.
create or replace function public.ghl_claim_jobs(p_limit integer default 10)
returns setof public.ghl_sync_jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.ghl_sync_jobs j set status = 'running', attempts = j.attempts + 1, updated_at = now()
  where j.id in (
    select id from public.ghl_sync_jobs
    where (status in ('pending', 'failed') and next_attempt_at <= now())
       or (status = 'running' and updated_at < now() - interval '10 minutes')
    order by next_attempt_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked)
  returning j.*;
end;
$$;
revoke execute on function public.ghl_claim_jobs(integer) from public, anon, authenticated;
grant execute on function public.ghl_claim_jobs(integer) to service_role;
