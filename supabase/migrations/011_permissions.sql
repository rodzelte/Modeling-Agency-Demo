-- 011: Data-driven permissions.
--
-- Replaces hard-coded role arrays in RLS with permissions granted to roles through
-- role_permissions. Changing who may do what is now a data change, and the app reads
-- the same matrix through current_permissions().
--
-- Also links talent-role users to their own talent record (agency_members.talent_id)
-- so talent users can only ever reach their own data.

create table if not exists public.permissions (
  key text primary key,
  module text not null,
  description text not null
);

create table if not exists public.role_permissions (
  role_key text not null references public.roles(key) on update cascade on delete cascade,
  permission_key text not null references public.permissions(key) on update cascade on delete cascade,
  primary key (role_key, permission_key)
);

insert into public.permissions (key, module, description) values
  ('dashboard.access',     'dashboard',  'Open the internal Agency OS dashboard'),
  ('talent.view',          'talent',     'View talent records (non-private fields)'),
  ('talent.create',        'talent',     'Create talent records'),
  ('talent.edit',          'talent',     'Edit talent records'),
  ('talent.publish',       'talent',     'Publish or unpublish talent on the website'),
  ('talent.archive',       'talent',     'Archive or restore talent records'),
  ('talent.delete',        'talent',     'Permanently delete talent records'),
  ('talent.private.view',  'talent',     'View private contact details, DOB, rates, addresses, related contacts'),
  ('talent.private.edit',  'talent',     'Edit private contact details, DOB, rates, addresses, related contacts'),
  ('boards.view',          'boards',     'View all boards, including internal boards'),
  ('boards.manage',        'boards',     'Create, edit, reorder, and deactivate boards'),
  ('boards.assign',        'boards',     'Assign talent to boards and remove assignments'),
  ('measurements.edit',    'talent',     'Record measurement snapshots'),
  ('skills.edit',          'talent',     'Edit talent skills'),
  ('agencies.manage',      'talent',     'Manage agencies and agency relationships'),
  ('notes.view',           'talent',     'View internal talent notes'),
  ('notes.edit',           'talent',     'Add internal talent notes'),
  ('media.view',           'media',      'View talent media, including private media'),
  ('media.manage',         'media',      'Upload, order, publish, and archive talent media'),
  ('legal.view',           'sensitive',  'View legal, tax, contract, and identification records'),
  ('legal.edit',           'sensitive',  'Edit legal, tax, contract, and identification records'),
  ('banking.view',         'sensitive',  'View masked banking records and reveal full values'),
  ('banking.edit',         'sensitive',  'Edit banking records'),
  ('medical.view',         'sensitive',  'View medical records'),
  ('medical.edit',         'sensitive',  'Edit medical records'),
  ('documents.view',       'sensitive',  'View and download private talent documents'),
  ('documents.manage',     'sensitive',  'Upload and archive private talent documents'),
  ('operations.view',      'operations', 'View usage, appointments, and items'),
  ('operations.manage',    'operations', 'Manage usage, appointments, and items'),
  ('website.manage',       'website',    'Manage website content and publishing settings'),
  ('audit.view',           'settings',   'View audit logs'),
  ('settings.manage',      'settings',   'Manage workspace settings'),
  ('team.manage',          'settings',   'Approve users and assign roles')
on conflict (key) do update set module = excluded.module, description = excluded.description;

-- Default matrix (docs/permissions.md). Only fills gaps, so owner edits made later
-- through role_permissions are never overwritten by a re-run.
-- Owner: everything. Administrator: everything except approving users / assigning roles.
insert into public.role_permissions (role_key, permission_key)
select r.role_key, p.key
from unnest(array['owner', 'administrator']) as r(role_key)
cross join public.permissions p
where not (r.role_key = 'administrator' and p.key = 'team.manage')
on conflict do nothing;

insert into public.role_permissions (role_key, permission_key)
select v.role_key, v.permission_key
from (values
  ('talent_manager', 'dashboard.access'), ('talent_manager', 'talent.view'), ('talent_manager', 'talent.create'),
  ('talent_manager', 'talent.edit'), ('talent_manager', 'talent.publish'), ('talent_manager', 'talent.archive'),
  ('talent_manager', 'talent.private.view'), ('talent_manager', 'talent.private.edit'), ('talent_manager', 'boards.view'),
  ('talent_manager', 'boards.manage'), ('talent_manager', 'boards.assign'), ('talent_manager', 'measurements.edit'),
  ('talent_manager', 'skills.edit'), ('talent_manager', 'agencies.manage'), ('talent_manager', 'notes.view'),
  ('talent_manager', 'notes.edit'), ('talent_manager', 'media.view'), ('talent_manager', 'media.manage'),
  ('talent_manager', 'documents.view'), ('talent_manager', 'documents.manage'), ('talent_manager', 'operations.view'),
  ('talent_manager', 'operations.manage'),

  ('booker', 'dashboard.access'), ('booker', 'talent.view'), ('booker', 'talent.create'), ('booker', 'talent.edit'),
  ('booker', 'talent.private.view'), ('booker', 'talent.private.edit'), ('booker', 'boards.view'), ('booker', 'boards.assign'),
  ('booker', 'measurements.edit'), ('booker', 'skills.edit'), ('booker', 'notes.view'), ('booker', 'notes.edit'),
  ('booker', 'media.view'), ('booker', 'operations.view'), ('booker', 'operations.manage'),

  ('creative', 'dashboard.access'), ('creative', 'talent.view'), ('creative', 'boards.view'),
  ('creative', 'media.view'), ('creative', 'media.manage'),

  ('accounting', 'dashboard.access'), ('accounting', 'talent.view'), ('accounting', 'talent.private.view'),
  ('accounting', 'boards.view'), ('accounting', 'legal.view'), ('accounting', 'legal.edit'), ('accounting', 'banking.view'),
  ('accounting', 'banking.edit'), ('accounting', 'documents.view'), ('accounting', 'documents.manage'),
  ('accounting', 'operations.view'),

  ('staff', 'dashboard.access'), ('staff', 'talent.view'), ('staff', 'boards.view'), ('staff', 'media.view'),
  ('staff', 'notes.view'), ('staff', 'operations.view'),

  ('read_only', 'dashboard.access'), ('read_only', 'talent.view'), ('read_only', 'boards.view'),
  ('read_only', 'media.view'), ('read_only', 'operations.view')
) as v(role_key, permission_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.has_permission(permission_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.role_permissions rp
    where rp.role_key = public.current_agency_role()
      and rp.permission_key = has_permission.permission_key
  );
$$;

create or replace function public.current_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(rp.permission_key order by rp.permission_key), '{}')
  from public.role_permissions rp
  where rp.role_key = public.current_agency_role();
$$;

-- Talent users: the talent record their login belongs to.
alter table public.agency_members add column if not exists talent_id uuid references public.talent(id) on delete set null;
create unique index if not exists agency_members_talent_id_idx on public.agency_members (talent_id) where talent_id is not null;
grant insert (talent_id), update (talent_id) on public.agency_members to authenticated;

create or replace function public.current_talent_id()
returns uuid language sql stable security definer set search_path = public as $$
  select am.talent_id from public.agency_members am
  where am.user_id = auth.uid() and am.status = 'active' and am.role = 'talent'
  limit 1;
$$;

revoke execute on function public.has_permission(text), public.current_permissions(), public.current_talent_id() from public, anon;
grant execute on function public.has_permission(text), public.current_permissions(), public.current_talent_id() to authenticated;

alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
revoke all on public.permissions, public.role_permissions from anon;

drop policy if exists "members read permissions" on public.permissions;
create policy "members read permissions" on public.permissions for select to authenticated using (public.is_active_agency_member());
drop policy if exists "team managers edit permissions" on public.permissions;
create policy "team managers edit permissions" on public.permissions for all to authenticated
  using (public.has_permission('team.manage')) with check (public.has_permission('team.manage'));

drop policy if exists "members read role permissions" on public.role_permissions;
create policy "members read role permissions" on public.role_permissions for select to authenticated using (public.is_active_agency_member());
drop policy if exists "team managers edit role permissions" on public.role_permissions;
create policy "team managers edit role permissions" on public.role_permissions for all to authenticated
  using (public.has_permission('team.manage')) with check (public.has_permission('team.manage'));

-- ---------------------------------------------------------------------------
-- Rebuild talent-module policies on permissions. Every existing policy on these
-- tables is dropped first, including any that predate the tracked migrations.
-- ---------------------------------------------------------------------------
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename = any (array[
      'boards','talent','talent_board_assignments','talent_measurements','talent_photos','talent_private_details',
      'talent_addresses','talent_contacts','talent_social_accounts','talent_skills','talent_notes','talent_legal',
      'talent_banking','talent_agencies','talent_documents','talent_items','talent_usages','talent_appointments',
      'talent_medical','audit_logs','audit_log'])
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end;
$$;

-- Boards: the public sees active published boards; staff see all.
create policy "public reads published boards" on public.boards for select to anon, authenticated
  using (is_active and publish_to_website and not internal_only);
create policy "staff read boards" on public.boards for select to authenticated using (public.has_permission('boards.view'));
create policy "board managers insert boards" on public.boards for insert to authenticated with check (public.has_permission('boards.manage'));
create policy "board managers update boards" on public.boards for update to authenticated
  using (public.has_permission('boards.manage')) with check (public.has_permission('boards.manage'));
create policy "owners delete boards" on public.boards for delete to authenticated using (public.has_permission('team.manage'));

-- Talent core.
create policy "staff read talent" on public.talent for select to authenticated
  using (public.has_permission('talent.view') or id = public.current_talent_id());
create policy "staff create talent" on public.talent for insert to authenticated with check (public.has_permission('talent.create'));
create policy "staff edit talent" on public.talent for update to authenticated
  using (public.has_permission('talent.edit') or public.has_permission('talent.publish') or public.has_permission('talent.archive'))
  with check (public.has_permission('talent.edit') or public.has_permission('talent.publish') or public.has_permission('talent.archive'));
create policy "owners delete talent" on public.talent for delete to authenticated using (public.has_permission('talent.delete'));

create policy "staff read board assignments" on public.talent_board_assignments for select to authenticated
  using (public.has_permission('talent.view') or talent_id = public.current_talent_id());
create policy "staff assign boards" on public.talent_board_assignments for insert to authenticated with check (public.has_permission('boards.assign'));
create policy "staff update board assignments" on public.talent_board_assignments for update to authenticated
  using (public.has_permission('boards.assign')) with check (public.has_permission('boards.assign'));
create policy "staff remove board assignments" on public.talent_board_assignments for delete to authenticated using (public.has_permission('boards.assign'));

-- Measurements are append-only history: insert and (for corrections) delete, never update.
create policy "staff read measurements" on public.talent_measurements for select to authenticated
  using (public.has_permission('talent.view') or talent_id = public.current_talent_id());
create policy "staff add measurements" on public.talent_measurements for insert to authenticated with check (public.has_permission('measurements.edit'));
create policy "staff delete measurements" on public.talent_measurements for delete to authenticated using (public.has_permission('measurements.edit'));
revoke update on public.talent_measurements from anon, authenticated;

create policy "staff read media" on public.talent_photos for select to authenticated
  using (public.has_permission('media.view') or talent_id = public.current_talent_id());
create policy "media managers insert media" on public.talent_photos for insert to authenticated with check (public.has_permission('media.manage'));
create policy "media managers update media" on public.talent_photos for update to authenticated
  using (public.has_permission('media.manage')) with check (public.has_permission('media.manage'));
create policy "media managers delete media" on public.talent_photos for delete to authenticated using (public.has_permission('media.manage'));

-- Private details, addresses, related contacts.
create policy "private readers read private details" on public.talent_private_details for select to authenticated
  using (public.has_permission('talent.private.view') or talent_id = public.current_talent_id());
create policy "private editors write private details" on public.talent_private_details for insert to authenticated with check (public.has_permission('talent.private.edit'));
create policy "private editors update private details" on public.talent_private_details for update to authenticated
  using (public.has_permission('talent.private.edit')) with check (public.has_permission('talent.private.edit'));

create policy "private readers read addresses" on public.talent_addresses for select to authenticated
  using (public.has_permission('talent.private.view') or talent_id = public.current_talent_id());
create policy "private editors manage addresses" on public.talent_addresses for all to authenticated
  using (public.has_permission('talent.private.edit')) with check (public.has_permission('talent.private.edit'));

create policy "private readers read contacts" on public.talent_contacts for select to authenticated
  using (public.has_permission('talent.private.view') or talent_id = public.current_talent_id());
create policy "private editors manage contacts" on public.talent_contacts for all to authenticated
  using (public.has_permission('talent.private.edit')) with check (public.has_permission('talent.private.edit'));

create policy "staff read social accounts" on public.talent_social_accounts for select to authenticated
  using (public.has_permission('talent.view') or talent_id = public.current_talent_id());
create policy "editors manage social accounts" on public.talent_social_accounts for all to authenticated
  using (public.has_permission('talent.edit')) with check (public.has_permission('talent.edit'));

create policy "staff read skills" on public.talent_skills for select to authenticated
  using (public.has_permission('talent.view') or talent_id = public.current_talent_id());
create policy "skill editors manage skills" on public.talent_skills for all to authenticated
  using (public.has_permission('skills.edit')) with check (public.has_permission('skills.edit'));

create policy "note readers read notes" on public.talent_notes for select to authenticated using (public.has_permission('notes.view'));
create policy "note editors add notes" on public.talent_notes for insert to authenticated with check (public.has_permission('notes.edit'));

create policy "staff read agency relationships" on public.talent_agencies for select to authenticated using (public.has_permission('talent.view'));
create policy "agency managers manage agency relationships" on public.talent_agencies for all to authenticated
  using (public.has_permission('agencies.manage')) with check (public.has_permission('agencies.manage'));

-- Sensitive modules.
create policy "legal readers read legal" on public.talent_legal for select to authenticated using (public.has_permission('legal.view'));
create policy "legal editors write legal" on public.talent_legal for insert to authenticated with check (public.has_permission('legal.edit'));
create policy "legal editors update legal" on public.talent_legal for update to authenticated
  using (public.has_permission('legal.edit')) with check (public.has_permission('legal.edit'));

create policy "banking readers read banking" on public.talent_banking for select to authenticated using (public.has_permission('banking.view'));
create policy "banking editors write banking" on public.talent_banking for insert to authenticated with check (public.has_permission('banking.edit'));
create policy "banking editors update banking" on public.talent_banking for update to authenticated
  using (public.has_permission('banking.edit')) with check (public.has_permission('banking.edit'));

create policy "medical readers read medical" on public.talent_medical for select to authenticated using (public.has_permission('medical.view'));
create policy "medical editors write medical" on public.talent_medical for insert to authenticated with check (public.has_permission('medical.edit'));
create policy "medical editors update medical" on public.talent_medical for update to authenticated
  using (public.has_permission('medical.edit')) with check (public.has_permission('medical.edit'));

create policy "document readers read documents" on public.talent_documents for select to authenticated using (public.has_permission('documents.view'));
create policy "document managers manage documents" on public.talent_documents for all to authenticated
  using (public.has_permission('documents.manage')) with check (public.has_permission('documents.manage'));

-- Operations.
create policy "operations readers read items" on public.talent_items for select to authenticated using (public.has_permission('operations.view'));
create policy "operations managers manage items" on public.talent_items for all to authenticated
  using (public.has_permission('operations.manage')) with check (public.has_permission('operations.manage'));
create policy "operations readers read usages" on public.talent_usages for select to authenticated using (public.has_permission('operations.view'));
create policy "operations managers manage usages" on public.talent_usages for all to authenticated
  using (public.has_permission('operations.manage')) with check (public.has_permission('operations.manage'));
create policy "operations readers read appointments" on public.talent_appointments for select to authenticated
  using (public.has_permission('operations.view') or talent_id = public.current_talent_id());
create policy "operations managers manage appointments" on public.talent_appointments for all to authenticated
  using (public.has_permission('operations.manage')) with check (public.has_permission('operations.manage'));

-- Audit.
create policy "auditors read audit logs" on public.audit_logs for select to authenticated using (public.has_permission('audit.view'));
create policy "auditors read legacy audit log" on public.audit_log for select to authenticated using (public.has_permission('audit.view'));

-- Owners manage memberships via the team.manage permission.
drop policy if exists "agency owners can manage memberships" on public.agency_members;
create policy "agency owners can manage memberships" on public.agency_members for all to authenticated
  using (public.has_permission('team.manage')) with check (public.has_permission('team.manage'));
drop policy if exists "agency members can view own membership" on public.agency_members;
create policy "agency members can view own membership" on public.agency_members for select to authenticated
  using (user_id = auth.uid() or public.has_permission('team.manage'));

-- ---------------------------------------------------------------------------
-- Storage: talent media and private documents
-- ---------------------------------------------------------------------------
drop policy if exists "agency staff read talent media" on storage.objects;
create policy "agency staff read talent media" on storage.objects for select to authenticated
  using (bucket_id in ('talent-public', 'talent-private') and public.has_permission('media.view'));

drop policy if exists "agency staff upload talent public media" on storage.objects;
drop policy if exists "agency staff update talent public media" on storage.objects;
drop policy if exists "agency staff delete talent public media" on storage.objects;
drop policy if exists "agency staff upload talent private media" on storage.objects;
drop policy if exists "agency staff update talent private media" on storage.objects;
drop policy if exists "agency staff delete talent private media" on storage.objects;
create policy "media managers upload talent media" on storage.objects for insert to authenticated
  with check (bucket_id in ('talent-public', 'talent-private') and public.has_permission('media.manage'));
create policy "media managers update talent media" on storage.objects for update to authenticated
  using (bucket_id in ('talent-public', 'talent-private') and public.has_permission('media.manage'));
create policy "media managers delete talent media" on storage.objects for delete to authenticated
  using (bucket_id in ('talent-public', 'talent-private') and public.has_permission('media.manage'));

drop policy if exists "document readers read talent documents" on storage.objects;
create policy "document readers read talent documents" on storage.objects for select to authenticated
  using (bucket_id = 'talent-documents' and public.has_permission('documents.view'));
drop policy if exists "document managers upload talent documents" on storage.objects;
create policy "document managers upload talent documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'talent-documents' and public.has_permission('documents.manage'));
drop policy if exists "document managers delete talent documents" on storage.objects;
create policy "document managers delete talent documents" on storage.objects for delete to authenticated
  using (bucket_id = 'talent-documents' and public.has_permission('documents.manage'));
