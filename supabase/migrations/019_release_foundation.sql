-- 019: Release foundation.
--
-- * Contract step for 012: the private columns still on public.talent (withdrawn
--   from the API since 012) are merged into talent_private_details once more,
--   verified, backed up into the non-API "archive" schema, and dropped.
--   The migration aborts rather than drop a value that was not copied.
-- * Sign-ins are audited from auth.users.last_sign_in_at, so password, Google and
--   magic-link logins are all covered and cannot be skipped by the app.
-- * rls_auto_enable() (Supabase's "enable RLS on new tables" event trigger) stays,
--   but is no longer executable through the API.

-- ---------------------------------------------------------------------------
-- 1. Contract: talent private columns
-- ---------------------------------------------------------------------------
create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;
do $$
declare
  private_columns text[] := array['date_of_birth', 'birth_place', 'nationality', 'mobile', 'phone', 'email', 'website',
    'allow_sms', 'email_icalendar', 'username', 'talent_login_enabled', 'talent_app_enabled',
    'minimum_tariff', 'minimum_hourly_rate', 'minimum_day_rate'];
  present text[];
  missing bigint;
begin
  select array_agg(column_name::text order by column_name) into present
  from information_schema.columns
  where table_schema = 'public' and table_name = 'talent' and column_name = any(private_columns);

  if present is null then
    return; -- already contracted
  end if;

  -- Merge anything 012 did not carry over (booleans on pre-existing rows, late edits).
  execute $sql$
    insert into public.talent_private_details (talent_id)
    select t.id from public.talent t
    on conflict (talent_id) do nothing
  $sql$;
  execute $sql$
    update public.talent_private_details pd set
      date_of_birth = coalesce(pd.date_of_birth, t.date_of_birth),
      birth_place = coalesce(pd.birth_place, nullif(t.birth_place, '')),
      nationality = coalesce(pd.nationality, nullif(t.nationality, '')),
      mobile = coalesce(pd.mobile, nullif(t.mobile, '')),
      phone = coalesce(pd.phone, nullif(t.phone, '')),
      email = coalesce(pd.email, nullif(t.email, '')),
      website = coalesce(pd.website, nullif(t.website, '')),
      username = coalesce(pd.username, nullif(t.username, '')),
      allow_sms = pd.allow_sms or coalesce(t.allow_sms, false),
      email_icalendar = pd.email_icalendar or coalesce(nullif(t.email_icalendar, ''), 'false') not in ('false', 'f', '0', 'no'),
      talent_login_enabled = pd.talent_login_enabled or coalesce(t.talent_login_enabled, false),
      talent_app_enabled = pd.talent_app_enabled or coalesce(t.talent_app_enabled, false),
      minimum_tariff = coalesce(pd.minimum_tariff, t.minimum_tariff),
      minimum_hourly_rate = coalesce(pd.minimum_hourly_rate, t.minimum_hourly_rate),
      minimum_day_rate = coalesce(pd.minimum_day_rate, t.minimum_day_rate)
    from public.talent t
    where t.id = pd.talent_id
  $sql$;

  -- Verify: every non-empty value on talent must now exist in private details.
  execute $sql$
    select count(*) from public.talent t
    left join public.talent_private_details pd on pd.talent_id = t.id
    where pd.talent_id is null
       or (t.date_of_birth is not null and pd.date_of_birth is null)
       or (nullif(t.birth_place, '') is not null and pd.birth_place is null)
       or (nullif(t.nationality, '') is not null and pd.nationality is null)
       or (nullif(t.mobile, '') is not null and pd.mobile is null)
       or (nullif(t.phone, '') is not null and pd.phone is null)
       or (nullif(t.email, '') is not null and pd.email is null)
       or (nullif(t.website, '') is not null and pd.website is null)
       or (nullif(t.username, '') is not null and pd.username is null)
       or (t.minimum_tariff is not null and pd.minimum_tariff is null)
       or (t.minimum_hourly_rate is not null and pd.minimum_hourly_rate is null)
       or (t.minimum_day_rate is not null and pd.minimum_day_rate is null)
  $sql$ into missing;
  if missing > 0 then
    raise exception '019: % talent rows have private values not present in talent_private_details; aborting contract step', missing;
  end if;

  -- Back up the columns outside the API before dropping them.
  execute format('create table if not exists archive.talent_private_columns_019 as select id as talent_id, now() as archived_at, %s from public.talent',
    array_to_string(present, ', '));
  execute 'revoke all on archive.talent_private_columns_019 from public, anon, authenticated';

  execute (select 'alter table public.talent ' || string_agg(format('drop column if exists %I', c), ', ') from unnest(present) c);
end $$;

comment on schema archive is 'Backups taken by migrations before a contract step. Not exposed through the API.';

-- ---------------------------------------------------------------------------
-- 2. Sign-in audit
-- ---------------------------------------------------------------------------
create or replace function public.audit_sign_in()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  member_role text;
begin
  if new.last_sign_in_at is null or new.last_sign_in_at is not distinct from old.last_sign_in_at then
    return new;
  end if;
  begin
    select m.role into member_role from public.agency_members m where m.user_id = new.id and m.status = 'active';
    if member_role is not null and exists (select 1 from public.profiles p where p.id = new.id) then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (new.id, 'auth.login', 'user', new.id, jsonb_build_object('role', member_role));
    else
      -- Unapproved accounts are recorded without an actor or email.
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (null, 'auth.login_unapproved', 'user', new.id, '{}'::jsonb);
    end if;
  exception when others then
    -- Auditing must never block a sign-in.
    raise log 'audit_sign_in failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function public.audit_sign_in() from public, anon, authenticated;

drop trigger if exists audit_sign_in on auth.users;
create trigger audit_sign_in
  after update of last_sign_in_at on auth.users
  for each row execute function public.audit_sign_in();

-- ---------------------------------------------------------------------------
-- 3. rls_auto_enable: keep the event trigger, remove API execute rights
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
