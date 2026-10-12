-- 022: Agency operations.
--
-- * companies (clients, brands, agencies …) and their contacts.
-- * bookings with one or more talent (booking_talent), a readable reference,
--   option/confirmed/cancelled/completed status, and links from the existing
--   talent_appointments / talent_usages rows.
-- * Money lives apart from the booking (booking_financials, booking_talent_fees)
--   behind finance.view / finance.manage, so staff who can see the schedule
--   cannot see fees.
-- * tasks, assignable to any team member, optionally linked to a record.
-- * talent_booking_conflicts() for double-booking warnings.
-- * Talent logins can read their own confirmed bookings (no money, no notes).

insert into public.permissions (key, module, description) values
  ('finance.view', 'finance', 'View booking fees, invoices and payments'),
  ('finance.manage', 'finance', 'Edit booking fees, invoices and payments')
on conflict (key) do nothing;
insert into public.role_permissions (role_key, permission_key)
select v.role_key, v.permission_key from (values
  ('owner', 'finance.view'), ('owner', 'finance.manage'), ('administrator', 'finance.view'), ('administrator', 'finance.manage'),
  ('accounting', 'finance.view'), ('accounting', 'finance.manage'),
  ('talent_manager', 'finance.view'), ('talent_manager', 'finance.manage'), ('booker', 'finance.view'), ('booker', 'finance.manage')
) as v(role_key, permission_key)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. Companies and contacts
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  kind text not null default 'client' check (kind in ('client', 'brand', 'agency', 'photographer', 'production', 'casting', 'other')),
  website text, email text, phone text,
  address_1 text, city text, state text, postal_code text, country text,
  billing_email text, notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists companies_name_idx on public.companies (lower(name));

create table if not exists public.company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  title text, email text, phone text, notes text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists company_contacts_company_idx on public.company_contacts (company_id, name);

-- ---------------------------------------------------------------------------
-- 2. Bookings
-- ---------------------------------------------------------------------------
create sequence if not exists public.booking_reference_seq;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('BK-' || lpad(nextval('public.booking_reference_seq')::text, 5, '0')),
  title text not null check (length(title) between 1 and 200),
  booking_type text not null default 'shoot' check (booking_type in ('shoot', 'show', 'fitting', 'casting', 'campaign', 'event', 'travel', 'other')),
  status text not null default 'option' check (status in ('option', 'confirmed', 'cancelled', 'completed')),
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.company_contacts(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  location text,
  usage_terms text,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at)
);
create index if not exists bookings_time_idx on public.bookings (start_at, end_at);
create index if not exists bookings_company_idx on public.bookings (company_id, start_at desc);
create index if not exists bookings_status_idx on public.bookings (status, start_at);

create table if not exists public.booking_talent (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  talent_id uuid not null references public.talent(id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  primary key (booking_id, talent_id)
);
create index if not exists booking_talent_talent_idx on public.booking_talent (talent_id);

create table if not exists public.booking_financials (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  rate_type text check (rate_type in ('day', 'half_day', 'hourly', 'flat', 'tbc')),
  fee_total numeric(12, 2) check (fee_total >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  commission_pct numeric(5, 2) check (commission_pct between 0 and 100),
  expenses numeric(12, 2) check (expenses >= 0),
  invoice_status text not null default 'not_invoiced' check (invoice_status in ('not_invoiced', 'invoiced', 'paid', 'written_off')),
  invoice_number text,
  invoiced_on date,
  paid_on date,
  notes text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists booking_financials_status_idx on public.booking_financials (invoice_status);

create table if not exists public.booking_talent_fees (
  booking_id uuid not null,
  talent_id uuid not null,
  fee numeric(12, 2) check (fee >= 0),
  paid_to_talent_on date,
  primary key (booking_id, talent_id),
  foreign key (booking_id, talent_id) references public.booking_talent(booking_id, talent_id) on delete cascade
);

alter table public.talent_appointments add column if not exists booking_id uuid references public.bookings(id) on delete set null;
alter table public.talent_usages add column if not exists booking_id uuid references public.bookings(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. Tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  notes text,
  status text not null default 'open' check (status in ('open', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_on date,
  assignee_id uuid references auth.users(id) on delete set null,
  related_type text check (related_type in ('talent', 'booking', 'company', 'application')),
  related_id uuid,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id, status, due_on);
create index if not exists tasks_status_idx on public.tasks (status, due_on);

-- ---------------------------------------------------------------------------
-- 4. Bookkeeping and audit
-- ---------------------------------------------------------------------------
create or replace function public.touch_operations_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_table_name in ('bookings', 'booking_financials') and auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  if tg_table_name = 'tasks' then
    new.completed_at := case when new.status = 'done' then coalesce(new.completed_at, now()) else null end;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['companies', 'company_contacts', 'bookings', 'booking_financials', 'tasks'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before update on public.%1$I for each row execute function public.touch_operations_row()', t);
  end loop;
end $$;
drop trigger if exists touch_tasks_insert on public.tasks;
create trigger touch_tasks_insert before insert on public.tasks for each row execute function public.touch_operations_row();

create or replace function public.audit_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'booking.created', 'booking', new.id, jsonb_build_object('reference', new.reference, 'status', new.status));
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'booking.deleted', 'booking', old.id, jsonb_build_object('reference', old.reference));
  elsif new.status is distinct from old.status or new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (auth.uid(), case when new.status is distinct from old.status then 'booking.status_changed' else 'booking.rescheduled' end, 'booking', new.id,
      jsonb_build_object('status', old.status, 'start_at', old.start_at, 'end_at', old.end_at),
      jsonb_build_object('status', new.status, 'start_at', new.start_at, 'end_at', new.end_at));
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists audit_booking on public.bookings;
create trigger audit_booking after insert or update or delete on public.bookings for each row execute function public.audit_booking();

-- Money changes are audited without the amounts.
create or replace function public.audit_booking_financials()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'booking.financials_changed', 'booking', coalesce(new.booking_id, old.booking_id),
    jsonb_build_object('table', tg_table_name, 'operation', lower(tg_op)));
  return coalesce(new, old);
end;
$$;
drop trigger if exists audit_booking_financials on public.booking_financials;
create trigger audit_booking_financials after insert or update or delete on public.booking_financials for each row execute function public.audit_booking_financials();
drop trigger if exists audit_booking_talent_fees on public.booking_talent_fees;
create trigger audit_booking_talent_fees after insert or update or delete on public.booking_talent_fees for each row execute function public.audit_booking_financials();

revoke execute on function public.touch_operations_row(), public.audit_booking(), public.audit_booking_financials() from public, anon, authenticated;

-- Overlapping options/confirmed bookings and appointments for the given talent.
create or replace function public.talent_booking_conflicts(p_talent_ids uuid[], p_start timestamptz, p_end timestamptz, p_exclude_booking uuid default null)
returns table (talent_id uuid, kind text, record_id uuid, label text, status text, start_at timestamptz, end_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select bt.talent_id, 'booking', b.id, b.reference || ' · ' || b.title, b.status, b.start_at, b.end_at
  from public.booking_talent bt join public.bookings b on b.id = bt.booking_id
  where bt.talent_id = any(p_talent_ids) and b.status in ('option', 'confirmed')
    and b.start_at < p_end and b.end_at > p_start and b.id is distinct from p_exclude_booking
  union all
  select a.talent_id, 'appointment', a.id, coalesce(nullif(a.event_type, ''), 'Appointment') || coalesce(' · ' || nullif(a.client, ''), ''), a.status, a.start_at, coalesce(a.end_at, a.start_at + interval '1 hour')
  from public.talent_appointments a
  where a.talent_id = any(p_talent_ids) and not a.cancelled and a.start_at is not null
    and a.start_at < p_end and coalesce(a.end_at, a.start_at + interval '1 hour') > p_start
    and (p_exclude_booking is null or a.booking_id is distinct from p_exclude_booking)
  order by 6;
$$;
revoke execute on function public.talent_booking_conflicts(uuid[], timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.talent_booking_conflicts(uuid[], timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.company_contacts enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_talent enable row level security;
alter table public.booking_financials enable row level security;
alter table public.booking_talent_fees enable row level security;
alter table public.tasks enable row level security;
revoke all on public.companies, public.company_contacts, public.bookings, public.booking_talent, public.booking_financials,
  public.booking_talent_fees, public.tasks from anon;
revoke all on sequence public.booking_reference_seq from anon;

do $$
declare t text;
begin
  foreach t in array array['companies', 'company_contacts', 'bookings', 'booking_talent'] loop
    execute format('drop policy if exists "operations readers read %1$s" on public.%1$I', t);
    execute format('create policy "operations readers read %1$s" on public.%1$I for select to authenticated using (public.has_permission(''operations.view''))', t);
    execute format('drop policy if exists "operations managers write %1$s" on public.%1$I', t);
    execute format('create policy "operations managers write %1$s" on public.%1$I for all to authenticated using (public.has_permission(''operations.manage'')) with check (public.has_permission(''operations.manage''))', t);
  end loop;
  foreach t in array array['booking_financials', 'booking_talent_fees'] loop
    execute format('drop policy if exists "finance readers read %1$s" on public.%1$I', t);
    execute format('create policy "finance readers read %1$s" on public.%1$I for select to authenticated using (public.has_permission(''finance.view''))', t);
    execute format('drop policy if exists "finance managers write %1$s" on public.%1$I', t);
    execute format('create policy "finance managers write %1$s" on public.%1$I for all to authenticated using (public.has_permission(''finance.manage'')) with check (public.has_permission(''finance.manage''))', t);
  end loop;
end $$;

-- Talent logins: their own confirmed/completed bookings (schedule only).
drop policy if exists "talent read own bookings" on public.bookings;
create policy "talent read own bookings" on public.bookings for select to authenticated
  using (status in ('confirmed', 'completed') and exists (select 1 from public.booking_talent bt where bt.booking_id = bookings.id and bt.talent_id = public.current_talent_id()));
drop policy if exists "talent read own booking rows" on public.booking_talent;
create policy "talent read own booking rows" on public.booking_talent for select to authenticated
  using (talent_id = public.current_talent_id());

-- Tasks: readers of operations see all tasks; everyone sees and completes their own.
drop policy if exists "task readers read tasks" on public.tasks;
create policy "task readers read tasks" on public.tasks for select to authenticated
  using (public.has_permission('operations.view') or (assignee_id = auth.uid() and public.has_permission('dashboard.access')));
drop policy if exists "task managers write tasks" on public.tasks;
create policy "task managers write tasks" on public.tasks for all to authenticated
  using (public.has_permission('operations.manage')) with check (public.has_permission('operations.manage'));
drop policy if exists "assignees update own tasks" on public.tasks;
create policy "assignees update own tasks" on public.tasks for update to authenticated
  using (assignee_id = auth.uid() and public.has_permission('dashboard.access'))
  with check (assignee_id = auth.uid());
drop policy if exists "members add own tasks" on public.tasks;
create policy "members add own tasks" on public.tasks for insert to authenticated
  with check (public.has_permission('dashboard.access') and assignee_id = auth.uid());
