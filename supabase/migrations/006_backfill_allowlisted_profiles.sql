-- Backfill profiles for approved Auth users created before the access-control trigger.
insert into public.profiles (id, email, full_name, role, status)
select
  u.id,
  lower(u.email),
  coalesce(nullif(am.full_name, ''), nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'name', ''), ''),
  am.role,
  am.status
from auth.users u
join public.agency_members am on lower(am.email) = lower(u.email)
on conflict (id) do update set
  email = excluded.email,
  full_name = case when excluded.full_name <> '' then excluded.full_name else public.profiles.full_name end,
  role = excluded.role,
  status = excluded.status,
  updated_at = now();

insert into public.profile_roles (profile_id, role_id)
select p.id, r.id
from public.profiles p
join public.agency_members am on lower(am.email) = lower(p.email)
join public.roles r on r.key = am.role
on conflict do nothing;
