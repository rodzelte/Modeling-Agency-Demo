-- Phase 21: talent subscriptions (Mobile Phase 2 in docs/mobile-roadmap.md).
-- A talent signs in to the portal (web now, the mobile app later) and needs an
-- active subscription to use its features. Paid access is decided here, in the
-- database, so the website, an iOS app and an Android app all obey the same rule.
--
-- * subscription_plans / plan_features: what each plan unlocks ('portal.full').
-- * talent_subscriptions: one row per talent. Staff with billing.manage can grant
--   complimentary access (provider 'manual'); a payment provider (Stripe) writes
--   'stripe' rows through its verified webhook once it is connected.
-- * billing_settings.require_subscription: the switch. Off by default, so turning
--   it on is a deliberate owner decision, not a side effect of this migration.
-- * has_entitlement(feature) is added to the talent write policies (change
--   requests, availability, digital uploads), so no client can skip the check.
-- Additive and idempotent.

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module, description) values
  ('billing.view', 'billing', 'See talent subscription plans and who is subscribed'),
  ('billing.manage', 'billing', 'Edit plans, require subscriptions, and grant complimentary access')
on conflict (key) do nothing;

insert into public.role_permissions (role_key, permission_key)
select v.role_key, v.permission_key
from (values
  ('owner', 'billing.view'), ('owner', 'billing.manage'),
  ('administrator', 'billing.view'), ('administrator', 'billing.manage'),
  ('accounting', 'billing.view'), ('accounting', 'billing.manage'),
  ('talent_manager', 'billing.view')
) as v(role_key, permission_key)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.billing_settings (
  id boolean primary key default true check (id),
  require_subscription boolean not null default false,
  grace_days integer not null default 7 check (grace_days between 0 and 60),
  updated_at timestamptz not null default now()
);
insert into public.billing_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.subscription_plans (
  key text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  price_cents integer check (price_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  stripe_price_id text check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  active boolean not null default true,
  display_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_features (
  plan_key text not null references public.subscription_plans(key) on delete cascade,
  feature_key text not null check (feature_key ~ '^[a-z]+(\.[a-z_]+)+$'),
  primary key (plan_key, feature_key)
);

insert into public.subscription_plans (key, name, description, display_order)
values ('pro', 'Talent Pro', 'Full talent portal: profile updates, digitals, availability, bookings and documents.', 1)
on conflict (key) do nothing;
insert into public.plan_features (plan_key, feature_key) values ('pro', 'portal.full') on conflict do nothing;

create table if not exists public.talent_subscriptions (
  talent_id uuid primary key references public.talent(id) on delete cascade,
  plan_key text not null references public.subscription_plans(key),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  provider text not null default 'manual' check (provider in ('manual', 'stripe')),
  provider_customer_id text,
  provider_subscription_id text unique,
  current_period_end timestamptz,
  cancel_at timestamptz,
  note text check (char_length(note) <= 300),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists talent_subscriptions_plan_idx on public.talent_subscriptions (plan_key);

-- Idempotent log of payment-provider events (written only by the webhook).
create table if not exists public.billing_events (
  provider text not null check (provider in ('stripe')),
  event_id text not null,
  type text not null,
  talent_id uuid references public.talent(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);
create index if not exists billing_events_talent_idx on public.billing_events (talent_id);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.billing_settings enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.plan_features enable row level security;
alter table public.talent_subscriptions enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.billing_settings, public.subscription_plans, public.plan_features, public.talent_subscriptions, public.billing_events from anon;
revoke insert, update, delete on public.billing_events from authenticated;

drop policy if exists "billing viewers read settings" on public.billing_settings;
create policy "billing viewers read settings" on public.billing_settings for select to authenticated using (public.has_permission('billing.view'));
drop policy if exists "billing managers edit settings" on public.billing_settings;
create policy "billing managers edit settings" on public.billing_settings for update to authenticated
  using (public.has_permission('billing.manage')) with check (public.has_permission('billing.manage'));

-- Plans are shown to signed-in talent on the subscribe page.
drop policy if exists "signed in read plans" on public.subscription_plans;
create policy "signed in read plans" on public.subscription_plans for select to authenticated
  using (active or public.has_permission('billing.view'));
drop policy if exists "billing managers edit plans" on public.subscription_plans;
create policy "billing managers edit plans" on public.subscription_plans for all to authenticated
  using (public.has_permission('billing.manage')) with check (public.has_permission('billing.manage'));
drop policy if exists "signed in read plan features" on public.plan_features;
create policy "signed in read plan features" on public.plan_features for select to authenticated using (true);
drop policy if exists "billing managers edit plan features" on public.plan_features;
create policy "billing managers edit plan features" on public.plan_features for all to authenticated
  using (public.has_permission('billing.manage')) with check (public.has_permission('billing.manage'));

-- A talent sees only their own subscription and can never write it.
drop policy if exists "talent and billing read subscriptions" on public.talent_subscriptions;
create policy "talent and billing read subscriptions" on public.talent_subscriptions for select to authenticated
  using (talent_id = public.current_talent_id() or public.has_permission('billing.view'));
-- Staff grant or end complimentary access only; provider rows come from the webhook.
drop policy if exists "billing managers grant access" on public.talent_subscriptions;
create policy "billing managers grant access" on public.talent_subscriptions for insert to authenticated
  with check (public.has_permission('billing.manage') and provider = 'manual');
drop policy if exists "billing managers change access" on public.talent_subscriptions;
create policy "billing managers change access" on public.talent_subscriptions for update to authenticated
  using (public.has_permission('billing.manage') and provider = 'manual')
  with check (public.has_permission('billing.manage') and provider = 'manual');
drop policy if exists "billing managers remove access" on public.talent_subscriptions;
create policy "billing managers remove access" on public.talent_subscriptions for delete to authenticated
  using (public.has_permission('billing.manage') and provider = 'manual');

drop policy if exists "billing viewers read events" on public.billing_events;
create policy "billing viewers read events" on public.billing_events for select to authenticated using (public.has_permission('billing.view'));

create or replace function public.stamp_talent_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end;
$$;
drop trigger if exists stamp_talent_subscription on public.talent_subscriptions;
create trigger stamp_talent_subscription before insert or update on public.talent_subscriptions
  for each row execute function public.stamp_talent_subscription();
revoke execute on function public.stamp_talent_subscription() from public, anon, authenticated;

-- Audit: who granted or changed access (no payment details exist here).
create or replace function public.audit_talent_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  row_data public.talent_subscriptions;
begin
  row_data := coalesce(new, old);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'subscription.' || lower(tg_op), 'talent', row_data.talent_id,
    jsonb_build_object('plan', row_data.plan_key, 'status', row_data.status, 'provider', row_data.provider));
  return null;
end;
$$;
drop trigger if exists audit_talent_subscription on public.talent_subscriptions;
create trigger audit_talent_subscription after insert or update or delete on public.talent_subscriptions
  for each row execute function public.audit_talent_subscription();
revoke execute on function public.audit_talent_subscription() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Entitlements
-- ---------------------------------------------------------------------------
-- True when the signed-in talent may use `p_feature`: subscriptions are not
-- required yet, or they hold an active/trialing plan with that feature (a
-- past-due payment keeps access for the grace period; complimentary access
-- ends at its end date, if one is set). Staff accounts are not talent: false.
create or replace function public.has_entitlement(p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (select public.current_talent_id() as talent_id),
  settings as (select require_subscription, grace_days from public.billing_settings where id)
  select case
    when (select talent_id from me) is null then false
    when not coalesce((select require_subscription from settings), false) then true
    else exists (
      select 1 from public.talent_subscriptions s
      join public.plan_features f on f.plan_key = s.plan_key and f.feature_key = p_feature
      where s.talent_id = (select talent_id from me)
        and (
          (s.status in ('trialing', 'active') and (s.provider <> 'manual' or s.current_period_end is null or s.current_period_end > now()))
          or (s.status = 'past_due' and s.current_period_end > now() - make_interval(days => coalesce((select grace_days from settings), 7)))
        ))
  end;
$$;

-- What the portal shows: whether a subscription is required, whether this
-- talent has access, and their current plan.
create or replace function public.my_subscription()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.current_talent_id() is null then null else jsonb_build_object(
    'required', coalesce((select require_subscription from public.billing_settings where id), false),
    'entitled', public.has_entitlement('portal.full'),
    'subscription', (select jsonb_build_object('plan', p.name, 'status', s.status, 'provider', s.provider, 'current_period_end', s.current_period_end, 'cancel_at', s.cancel_at)
      from public.talent_subscriptions s join public.subscription_plans p on p.key = s.plan_key
      where s.talent_id = public.current_talent_id())
  ) end;
$$;

revoke execute on function public.has_entitlement(text), public.my_subscription() from public, anon;
grant execute on function public.has_entitlement(text), public.my_subscription() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Talent write policies require the entitlement (staff are unaffected)
-- ---------------------------------------------------------------------------
drop policy if exists "talent create own requests" on public.talent_change_requests;
create policy "talent create own requests" on public.talent_change_requests for insert to authenticated
  with check (talent_id = public.current_talent_id() and public.has_entitlement('portal.full'));

drop policy if exists "availability writers" on public.talent_availability;
create policy "availability writers" on public.talent_availability for all to authenticated
  using ((talent_id = public.current_talent_id() and public.has_entitlement('portal.full')) or public.has_permission('operations.manage'))
  with check ((talent_id = public.current_talent_id() and public.has_entitlement('portal.full')) or public.has_permission('operations.manage'));

drop policy if exists "talent add own digitals" on public.talent_photos;
create policy "talent add own digitals" on public.talent_photos for insert to authenticated
  with check (
    talent_id = public.current_talent_id() and public.has_entitlement('portal.full') and uploaded_by_talent and review_status = 'pending'
    and not "public" and public_storage_path is null and storage_bucket = 'talent-private'
    and storage_path like 'talent/' || talent_id::text || '/portal/%'
  );

drop policy if exists "talent upload own digitals" on storage.objects;
create policy "talent upload own digitals" on storage.objects for insert to authenticated
  with check (bucket_id = 'talent-private' and public.current_talent_id() is not null and public.has_entitlement('portal.full')
    and name like 'talent/' || public.current_talent_id()::text || '/portal/%');
