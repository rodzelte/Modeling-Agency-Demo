-- Operational and restricted talent modules required by the agency workflow.
create table if not exists public.talent_legal (
  talent_id uuid primary key references public.talent(id) on delete cascade,
  legal_first_name text, legal_middle_name text, legal_last_name text, company_name text,
  non_resident boolean not null default false, tax_number text, accounting_number text,
  insurance_number text, talent_tax_percent numeric, own_tax_responsible boolean not null default false,
  talent_commission_percent numeric, contract_name text, contract_signed_on date,
  contract_returned boolean not null default false, contract_expires_on date,
  work_permit_number text, work_permit_country text, work_permit_issued_on date, work_permit_expires_on date,
  stop_payments boolean not null default false, stop_payments_notes text,
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.talent_banking (
  talent_id uuid primary key references public.talent(id) on delete cascade,
  description text, contact text, account_name text, account_number text, routing_number text,
  swift_aba text, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.talent_agencies (
  id uuid primary key default gen_random_uuid(), talent_id uuid not null references public.talent(id) on delete cascade,
  agency_name text not null, country text, city text, phone text, mother_agency_percent numeric,
  mother_agency boolean not null default false, placement text, contract_received boolean not null default false,
  start_date date, end_date date, created_at timestamptz not null default now()
);

create table if not exists public.talent_documents (
  id uuid primary key default gen_random_uuid(), talent_id uuid not null references public.talent(id) on delete cascade,
  file_name text not null, storage_path text not null, description text, category text, visibility text not null default 'private',
  uploaded_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  constraint talent_documents_visibility_check check (visibility in ('private','staff','public'))
);

create table if not exists public.talent_items (
  id uuid primary key default gen_random_uuid(), talent_id uuid not null references public.talent(id) on delete cascade,
  item_type text not null, description text, size text, condition text, status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.talent_usages (
  id uuid primary key default gen_random_uuid(), talent_id uuid not null references public.talent(id) on delete cascade,
  event_type text, usage_type text, client text, product text, start_date date, end_date date,
  booker text, exclusivity text, board text, notes text, created_at timestamptz not null default now()
);

create table if not exists public.talent_appointments (
  id uuid primary key default gen_random_uuid(), talent_id uuid not null references public.talent(id) on delete cascade,
  event_type text, job_type text, client text, product text, start_at timestamptz, end_at timestamptz,
  status text not null default 'scheduled', notes text, cancelled boolean not null default false,
  booker text, board text, created_at timestamptz not null default now()
);

create table if not exists public.talent_medical (
  talent_id uuid primary key references public.talent(id) on delete cascade,
  doctor text, office_address text, office_phone text, last_visit date, medical_notes text,
  medical_approval text, valid_through date, last_image_date date, availability text,
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null
);

create index if not exists talent_agencies_talent_idx on public.talent_agencies(talent_id);
create index if not exists talent_documents_talent_idx on public.talent_documents(talent_id, created_at desc);
create index if not exists talent_items_talent_idx on public.talent_items(talent_id, created_at desc);
create index if not exists talent_usages_talent_idx on public.talent_usages(talent_id, start_date desc);
create index if not exists talent_appointments_talent_idx on public.talent_appointments(talent_id, start_at desc);

alter table public.talent_legal enable row level security;
alter table public.talent_banking enable row level security;
alter table public.talent_agencies enable row level security;
alter table public.talent_documents enable row level security;
alter table public.talent_items enable row level security;
alter table public.talent_usages enable row level security;
alter table public.talent_appointments enable row level security;
alter table public.talent_medical enable row level security;

drop policy if exists "restricted legal access" on public.talent_legal;
create policy "restricted legal access" on public.talent_legal for all to authenticated
  using (public.has_any_role(array['owner','administrator','accounting']))
  with check (public.has_any_role(array['owner','administrator','accounting']));
drop policy if exists "restricted banking access" on public.talent_banking;
create policy "restricted banking access" on public.talent_banking for all to authenticated
  using (public.has_any_role(array['owner','administrator','accounting']))
  with check (public.has_any_role(array['owner','administrator','accounting']));
drop policy if exists "agency managers manage agencies" on public.talent_agencies;
create policy "agency managers manage agencies" on public.talent_agencies for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager']))
  with check (public.has_any_role(array['owner','administrator','talent_manager']));
drop policy if exists "agency staff manage documents" on public.talent_documents;
create policy "agency staff manage documents" on public.talent_documents for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager','accounting']))
  with check (public.has_any_role(array['owner','administrator','talent_manager','accounting']));
drop policy if exists "agency staff manage items" on public.talent_items;
create policy "agency staff manage items" on public.talent_items for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager']))
  with check (public.has_any_role(array['owner','administrator','talent_manager']));
drop policy if exists "agency staff manage usages" on public.talent_usages;
create policy "agency staff manage usages" on public.talent_usages for all to authenticated
  using (public.has_any_role(array['owner','administrator','booker','talent_manager']))
  with check (public.has_any_role(array['owner','administrator','booker','talent_manager']));
drop policy if exists "agency staff manage appointments" on public.talent_appointments;
create policy "agency staff manage appointments" on public.talent_appointments for all to authenticated
  using (public.has_any_role(array['owner','administrator','booker','talent_manager']))
  with check (public.has_any_role(array['owner','administrator','booker','talent_manager']));
drop policy if exists "restricted medical access" on public.talent_medical;
create policy "restricted medical access" on public.talent_medical for all to authenticated
  using (public.has_any_role(array['owner','administrator','talent_manager']))
  with check (public.has_any_role(array['owner','administrator','talent_manager']));
