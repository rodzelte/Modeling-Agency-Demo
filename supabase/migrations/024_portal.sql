-- 024: Talent portal.
--
-- Talent sign in with a magic link and see ONLY their own record. Staff invite
-- them (agency_members role 'talent' + talent_id). Nothing a talent does changes
-- their record directly: contact, address, measurement and social changes are
-- requests that staff approve; uploaded digitals wait for review before they can
-- be made public.
--
-- * talent_private_details is no longer readable by talent directly (it holds
--   internal notes and login flags); portal_profile() returns an allow-listed view.
-- * talent_change_requests, apply_change_request() (staff), talent_availability.
-- * talent_photos.review_status; talent may add pending photos to their own
--   portal folder in talent-private and nothing else.
-- * talent_documents.shared_with_talent; talent download only shared documents.
-- * invite_talent_to_portal() / revoke_talent_portal() for staff.

-- ---------------------------------------------------------------------------
-- 1. Tighten direct access
-- ---------------------------------------------------------------------------
drop policy if exists "private readers read private details" on public.talent_private_details;
create policy "private readers read private details" on public.talent_private_details for select to authenticated
  using (public.has_permission('talent.private.view'));

-- Emergency/guardian contacts may include staff notes; the portal shows guardians via portal_profile().
drop policy if exists "private readers read contacts" on public.talent_contacts;
create policy "private readers read contacts" on public.talent_contacts for select to authenticated
  using (public.has_permission('talent.private.view'));

-- ---------------------------------------------------------------------------
-- 2. Portal profile (allow-listed)
-- ---------------------------------------------------------------------------
create or replace function public.portal_profile()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.current_talent_id();
begin
  if me is null then return null; end if;
  return (
    select jsonb_build_object(
      'id', t.id, 'display_name', t.display_name, 'first_name', t.first_name, 'last_name', t.last_name,
      'location', t.location, 'gender', t.gender, 'is_minor', t.is_minor, 'slug', t.slug,
      'live_on_website', t.publication_status = 'published' and t.show_on_website and t.archived_at is null,
      'contact', (select jsonb_build_object('email', pd.email, 'mobile', pd.mobile, 'phone', pd.phone, 'date_of_birth', pd.date_of_birth)
                  from public.talent_private_details pd where pd.talent_id = t.id),
      'address', (select jsonb_build_object('address_1', a.address_1, 'address_2', a.address_2, 'city', a.city, 'state', a.state, 'postal_code', a.postal_code, 'country', a.country)
                  from public.talent_addresses a where a.talent_id = t.id order by a.is_main desc, a.created_at limit 1),
      'measurements', (select jsonb_build_object('height_cm', m.height_cm, 'bust_cm', m.bust_chest_cm, 'waist_cm', m.waist_cm, 'hips_cm', m.hips_cm,
                         'shoe_size', m.shoe_size_us, 'hair_color', m.hair_color, 'eye_color', m.eye_color, 'measured_on', m.measured_on)
                       from public.talent_measurements m where m.talent_id = t.id order by m.is_official desc, m.measured_on desc, m.created_at desc limit 1),
      'instagram', (select s.handle from public.talent_social_accounts s where s.talent_id = t.id and lower(s.platform) = 'instagram' order by s.created_at limit 1),
      'boards', coalesce((select jsonb_agg(b.name order by b.name) from public.talent_board_assignments tba join public.boards b on b.id = tba.board_id where tba.talent_id = t.id), '[]'::jsonb)
    )
    from public.talent t where t.id = me
  );
end;
$$;
revoke execute on function public.portal_profile() from public, anon;
grant execute on function public.portal_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Change requests
-- ---------------------------------------------------------------------------
create table if not exists public.talent_change_requests (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null default auth.uid(),
  field_group text not null check (field_group in ('contact', 'address', 'measurements', 'social')),
  changes jsonb not null check (jsonb_typeof(changes) = 'object'),
  message text check (length(message) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists talent_change_requests_status_idx on public.talent_change_requests (status, created_at desc);
create index if not exists talent_change_requests_talent_idx on public.talent_change_requests (talent_id, created_at desc);

-- Only known keys with short string/number values are accepted.
create or replace function public.check_change_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  allowed text[] := case new.field_group
    when 'contact' then array['email', 'mobile', 'phone']
    when 'address' then array['address_1', 'address_2', 'city', 'state', 'postal_code', 'country']
    when 'measurements' then array['height_cm', 'bust_cm', 'waist_cm', 'hips_cm', 'shoe_size', 'hair_color', 'eye_color']
    when 'social' then array['instagram'] end;
  key text;
begin
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;
    if auth.uid() is not null then new.requested_by := auth.uid(); end if;
  end if;
  for key in select jsonb_object_keys(new.changes) loop
    if not key = any(allowed) then
      raise exception 'Field "%" cannot be changed through the portal', key using errcode = '22023';
    end if;
    if jsonb_typeof(new.changes -> key) not in ('string', 'number', 'null') or length((new.changes ->> key)) > 200 then
      raise exception 'Invalid value for "%"', key using errcode = '22023';
    end if;
  end loop;
  if new.changes = '{}'::jsonb then raise exception 'Nothing to change' using errcode = '22023'; end if;
  return new;
end;
$$;
drop trigger if exists check_change_request on public.talent_change_requests;
create trigger check_change_request before insert or update of changes, field_group on public.talent_change_requests
  for each row execute function public.check_change_request();

alter table public.talent_change_requests enable row level security;
revoke all on public.talent_change_requests from anon;
revoke update, delete on public.talent_change_requests from authenticated;
grant update (status) on public.talent_change_requests to authenticated;

drop policy if exists "talent read own requests" on public.talent_change_requests;
create policy "talent read own requests" on public.talent_change_requests for select to authenticated
  using (talent_id = public.current_talent_id() or public.has_permission('talent.private.view'));
drop policy if exists "talent create own requests" on public.talent_change_requests;
create policy "talent create own requests" on public.talent_change_requests for insert to authenticated
  with check (talent_id = public.current_talent_id());
-- Talent may withdraw their own pending request; staff decide through apply_change_request().
drop policy if exists "talent withdraw own requests" on public.talent_change_requests;
create policy "talent withdraw own requests" on public.talent_change_requests for update to authenticated
  using (talent_id = public.current_talent_id() and status = 'pending')
  with check (talent_id = public.current_talent_id() and status = 'withdrawn');

create or replace function public.apply_change_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  req public.talent_change_requests%rowtype;
  c jsonb;
  num numeric;
begin
  select * into req from public.talent_change_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if req.status <> 'pending' then raise exception 'This request has already been handled' using errcode = '22023'; end if;
  if not (case req.field_group
            when 'measurements' then public.has_permission('measurements.edit')
            when 'social' then public.has_permission('talent.edit')
            else public.has_permission('talent.private.edit') end) then
    raise exception 'You do not have permission to review this request' using errcode = '42501';
  end if;
  c := req.changes;

  if p_approve then
    if req.field_group = 'contact' then
      insert into public.talent_private_details (talent_id) values (req.talent_id) on conflict (talent_id) do nothing;
      update public.talent_private_details set
        email = case when c ? 'email' then nullif(c ->> 'email', '') else email end,
        mobile = case when c ? 'mobile' then nullif(c ->> 'mobile', '') else mobile end,
        phone = case when c ? 'phone' then nullif(c ->> 'phone', '') else phone end
      where talent_id = req.talent_id;
    elsif req.field_group = 'address' then
      if exists (select 1 from public.talent_addresses where talent_id = req.talent_id and is_main) then
        update public.talent_addresses set
          address_1 = coalesce(c ->> 'address_1', address_1), address_2 = coalesce(c ->> 'address_2', address_2),
          city = coalesce(c ->> 'city', city), state = coalesce(c ->> 'state', state),
          postal_code = coalesce(c ->> 'postal_code', postal_code), country = coalesce(c ->> 'country', country), updated_at = now()
        where talent_id = req.talent_id and is_main;
      else
        insert into public.talent_addresses (talent_id, label, address_1, address_2, city, state, postal_code, country, is_main)
        values (req.talent_id, 'Home', c ->> 'address_1', c ->> 'address_2', c ->> 'city', c ->> 'state', c ->> 'postal_code', c ->> 'country', true);
      end if;
    elsif req.field_group = 'measurements' then
      insert into public.talent_measurements (talent_id, height_cm, bust_chest_cm, waist_cm, hips_cm, shoe_size_us, hair_color, eye_color, notes)
      select req.talent_id,
        coalesce((c ->> 'height_cm')::numeric, m.height_cm), coalesce((c ->> 'bust_cm')::numeric, m.bust_chest_cm),
        coalesce((c ->> 'waist_cm')::numeric, m.waist_cm), coalesce((c ->> 'hips_cm')::numeric, m.hips_cm),
        coalesce(c ->> 'shoe_size', m.shoe_size_us::text), coalesce(c ->> 'hair_color', m.hair_color), coalesce(c ->> 'eye_color', m.eye_color),
        'Approved from a talent portal request'
      from (select 1) one
      left join lateral (select * from public.talent_measurements x where x.talent_id = req.talent_id order by x.is_official desc, x.measured_on desc, x.created_at desc limit 1) m on true;
    elsif req.field_group = 'social' then
      if exists (select 1 from public.talent_social_accounts where talent_id = req.talent_id and lower(platform) = 'instagram') then
        update public.talent_social_accounts set handle = nullif(c ->> 'instagram', '') where talent_id = req.talent_id and lower(platform) = 'instagram';
      elsif nullif(c ->> 'instagram', '') is not null then
        insert into public.talent_social_accounts (talent_id, platform, handle) values (req.talent_id, 'instagram', c ->> 'instagram');
      end if;
    end if;
  end if;

  update public.talent_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(p_note, 1000)
  where id = req.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_approve then 'portal.change_approved' else 'portal.change_rejected' end, 'talent', req.talent_id,
    jsonb_build_object('group', req.field_group, 'fields', (select jsonb_agg(k) from jsonb_object_keys(c) k)));
exception when invalid_text_representation then
  raise exception 'A measurement in this request is not a number' using errcode = '22023';
end;
$$;
revoke execute on function public.check_change_request() from public, anon, authenticated;
revoke execute on function public.apply_change_request(uuid, boolean, text) from public, anon;
grant execute on function public.apply_change_request(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Availability
-- ---------------------------------------------------------------------------
create table if not exists public.talent_availability (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talent(id) on delete cascade,
  kind text not null default 'unavailable' check (kind in ('unavailable', 'holiday', 'available')),
  start_on date not null,
  end_on date not null,
  note text check (length(note) <= 300),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (end_on >= start_on)
);
create index if not exists talent_availability_talent_idx on public.talent_availability (talent_id, start_on);

alter table public.talent_availability enable row level security;
revoke all on public.talent_availability from anon;
drop policy if exists "availability readers" on public.talent_availability;
create policy "availability readers" on public.talent_availability for select to authenticated
  using (talent_id = public.current_talent_id() or public.has_permission('operations.view'));
drop policy if exists "availability writers" on public.talent_availability;
create policy "availability writers" on public.talent_availability for all to authenticated
  using (talent_id = public.current_talent_id() or public.has_permission('operations.manage'))
  with check (talent_id = public.current_talent_id() or public.has_permission('operations.manage'));

-- ---------------------------------------------------------------------------
-- 5. Digitals uploaded by talent
-- ---------------------------------------------------------------------------
alter table public.talent_photos
  add column if not exists review_status text not null default 'approved' check (review_status in ('approved', 'pending', 'rejected')),
  add column if not exists uploaded_by_talent boolean not null default false;

drop policy if exists "talent add own digitals" on public.talent_photos;
create policy "talent add own digitals" on public.talent_photos for insert to authenticated
  with check (
    talent_id = public.current_talent_id() and uploaded_by_talent and review_status = 'pending'
    and not "public" and public_storage_path is null and storage_bucket = 'talent-private'
    and storage_path like 'talent/' || talent_id::text || '/portal/%'
  );

-- A photo can only become public once staff have approved it.
create or replace function public.guard_photo_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new."public" and new.review_status <> 'approved' then
    raise exception 'Approve this photo before making it public' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_photo_review on public.talent_photos;
create trigger guard_photo_review before insert or update on public.talent_photos for each row execute function public.guard_photo_review();
revoke execute on function public.guard_photo_review() from public, anon, authenticated;

drop policy if exists "talent upload own digitals" on storage.objects;
create policy "talent upload own digitals" on storage.objects for insert to authenticated
  with check (bucket_id = 'talent-private' and public.current_talent_id() is not null
    and name like 'talent/' || public.current_talent_id()::text || '/portal/%');
drop policy if exists "talent read own media files" on storage.objects;
create policy "talent read own media files" on storage.objects for select to authenticated
  using (bucket_id in ('talent-private', 'talent-public') and public.current_talent_id() is not null
    and name like 'talent/' || public.current_talent_id()::text || '/%');

-- ---------------------------------------------------------------------------
-- 6. Documents shared with the talent
-- ---------------------------------------------------------------------------
alter table public.talent_documents add column if not exists shared_with_talent boolean not null default false;

drop policy if exists "talent read shared documents" on public.talent_documents;
create policy "talent read shared documents" on public.talent_documents for select to authenticated
  using (talent_id = public.current_talent_id() and shared_with_talent and archived_at is null);
drop policy if exists "talent read shared document files" on storage.objects;
create policy "talent read shared document files" on storage.objects for select to authenticated
  using (bucket_id = 'talent-documents' and exists (
    select 1 from public.talent_documents d
    where d.storage_path = name and d.talent_id = public.current_talent_id() and d.shared_with_talent and d.archived_at is null));

-- ---------------------------------------------------------------------------
-- 7. Invitations
-- ---------------------------------------------------------------------------
create or replace function public.invite_talent_to_portal(p_talent_id uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  existing public.agency_members%rowtype;
  talent_name text;
  normalized text := lower(trim(p_email));
begin
  if not public.has_permission('talent.private.edit') then
    raise exception 'You do not have permission to invite talent' using errcode = '42501';
  end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = '22023'; end if;
  select display_name into talent_name from public.talent where id = p_talent_id and archived_at is null;
  if talent_name is null then raise exception 'Talent not found' using errcode = 'P0002'; end if;

  select * into existing from public.agency_members where lower(email) = normalized;
  if found and (existing.role <> 'talent' or (existing.talent_id is not null and existing.talent_id <> p_talent_id)) then
    raise exception 'That email already belongs to another account' using errcode = '23505';
  end if;
  -- One portal login per talent: replace any previous email for this talent.
  delete from public.agency_members where talent_id = p_talent_id and role = 'talent' and lower(email) <> normalized;
  insert into public.agency_members (email, full_name, role, status, talent_id)
  values (normalized, talent_name, 'talent', 'active', p_talent_id)
  on conflict ((lower(email))) do update set role = 'talent', status = 'active', talent_id = p_talent_id, updated_at = now();

  insert into public.audit_logs (actor_id, action, entity_type, entity_id) values (auth.uid(), 'portal.invited', 'talent', p_talent_id);
end;
$$;

create or replace function public.revoke_talent_portal(p_talent_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('talent.private.edit') then
    raise exception 'You do not have permission to change portal access' using errcode = '42501';
  end if;
  update public.agency_members set status = 'suspended', updated_at = now() where talent_id = p_talent_id and role = 'talent';
  insert into public.audit_logs (actor_id, action, entity_type, entity_id) values (auth.uid(), 'portal.revoked', 'talent', p_talent_id);
end;
$$;

create or replace function public.portal_access(p_talent_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.has_permission('talent.private.view') then (
    select jsonb_build_object('email', m.email, 'status', m.status, 'signed_up', m.user_id is not null)
    from public.agency_members m where m.talent_id = p_talent_id and m.role = 'talent' limit 1) end;
$$;

revoke execute on function public.invite_talent_to_portal(uuid, text), public.revoke_talent_portal(uuid), public.portal_access(uuid) from public, anon;
grant execute on function public.invite_talent_to_portal(uuid, text), public.revoke_talent_portal(uuid), public.portal_access(uuid) to authenticated;
