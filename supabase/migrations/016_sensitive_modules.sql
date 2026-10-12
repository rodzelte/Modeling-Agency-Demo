-- 016: Sensitive administrative modules — legal/identification, banking, documents,
-- medical. Access is governed by the legal.*, banking.*, documents.*, medical.*
-- permissions from 011; nothing here is reachable by anon or exposed by public views.

-- Legal, tax, contract, work permit, and identification (Other tab: passport/visa/ID).
alter table public.talent_legal
  add column if not exists freelancer boolean not null default false,
  add column if not exists account_balance numeric,
  add column if not exists reserve_amount numeric,
  add column if not exists credit_status text,
  add column if not exists passport_number text,
  add column if not exists passport_country text,
  add column if not exists passport_requested_on date,
  add column if not exists passport_issued_on date,
  add column if not exists passport_expires_on date,
  add column if not exists visa_type text,
  add column if not exists visa_expires_on date,
  add column if not exists driver_license_number text,
  add column if not exists driver_license_state text,
  add column if not exists driver_license_expires_on date,
  add column if not exists created_at timestamptz not null default now();

alter table public.talent_banking add column if not exists created_at timestamptz not null default now();
alter table public.talent_medical add column if not exists created_at timestamptz not null default now();

-- Expiry lookups for dashboard alerts.
create index if not exists talent_legal_contract_expiry_idx on public.talent_legal (contract_expires_on) where contract_expires_on is not null;
create index if not exists talent_legal_passport_expiry_idx on public.talent_legal (passport_expires_on) where passport_expires_on is not null;
create index if not exists talent_legal_visa_expiry_idx on public.talent_legal (visa_expires_on) where visa_expires_on is not null;
create index if not exists talent_legal_permit_expiry_idx on public.talent_legal (work_permit_expires_on) where work_permit_expires_on is not null;

-- Stamp who changed a sensitive record.
create or replace function public.stamp_updated_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists stamp_legal on public.talent_legal;
create trigger stamp_legal before insert or update on public.talent_legal for each row execute procedure public.stamp_updated_by();
drop trigger if exists stamp_banking on public.talent_banking;
create trigger stamp_banking before insert or update on public.talent_banking for each row execute procedure public.stamp_updated_by();
drop trigger if exists stamp_medical on public.talent_medical;
create trigger stamp_medical before insert or update on public.talent_medical for each row execute procedure public.stamp_updated_by();

-- Changes to sensitive records are audited without copying their values.
create or replace function public.audit_sensitive_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed text[];
begin
  select coalesce(array_agg(key order by key), '{}') into changed
  from jsonb_each(to_jsonb(new)) n
  where key not in ('updated_at', 'updated_by', 'created_at')
    and (tg_op = 'INSERT' or n.value is distinct from (to_jsonb(old) -> n.key));
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), replace(tg_table_name, 'talent_', '') || '.' || lower(tg_op), 'talent', new.talent_id,
          jsonb_build_object('fields', to_jsonb(changed)));
  return null;
end;
$$;

drop trigger if exists audit_legal on public.talent_legal;
create trigger audit_legal after insert or update on public.talent_legal for each row execute procedure public.audit_sensitive_change();
drop trigger if exists audit_banking on public.talent_banking;
create trigger audit_banking after insert or update on public.talent_banking for each row execute procedure public.audit_sensitive_change();
drop trigger if exists audit_medical on public.talent_medical;
create trigger audit_medical after insert or update on public.talent_medical for each row execute procedure public.audit_sensitive_change();

-- ---------------------------------------------------------------------------
-- Documents: private storage metadata
-- ---------------------------------------------------------------------------
alter table public.talent_documents
  add column if not exists storage_bucket text not null default 'talent-documents',
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists archived_at timestamptz;

alter table public.talent_documents drop constraint if exists talent_documents_bucket_check;
alter table public.talent_documents add constraint talent_documents_bucket_check check (storage_bucket = 'talent-documents');

drop trigger if exists stamp_document_uploader on public.talent_documents;
create or replace function public.stamp_uploaded_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.uploaded_by := auth.uid(); end if;
  return new;
end;
$$;
create trigger stamp_document_uploader before insert on public.talent_documents
  for each row execute procedure public.stamp_uploaded_by();

-- Documents are archived, not deleted, by users (owners may still delete via storage/SQL).
drop policy if exists "document managers manage documents" on public.talent_documents;
drop policy if exists "document managers add documents" on public.talent_documents;
drop policy if exists "document managers update documents" on public.talent_documents;
create policy "document managers add documents" on public.talent_documents for insert to authenticated
  with check (public.has_permission('documents.manage'));
create policy "document managers update documents" on public.talent_documents for update to authenticated
  using (public.has_permission('documents.manage')) with check (public.has_permission('documents.manage'));
